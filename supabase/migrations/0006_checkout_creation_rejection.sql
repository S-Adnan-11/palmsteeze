-- Only a definitive first-dispatch Stripe validation rejection can release
-- pre-session inventory. Retries after a lost response remain conservative.
alter table public.payment_attempts drop constraint payment_attempts_state_check;
alter table public.payment_attempts add constraint payment_attempts_state_check
 check(state in ('creating','open','paid','expired','refund_required','refunded','review_required','creation_failed'));
create or replace function public.claim_payment_work(p_booking uuid default null,p_limit integer default 2)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.payment_jobs; result jsonb:='[]'; token uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 if p_limit is null or p_limit not between 1 and 2 then raise exception using errcode='22023',message='Bounded batch required'; end if;
 for job in select j.* from private.payment_jobs j join public.payment_attempts a on a.id=j.attempt_id
  where (j.lease_until is null or j.lease_until<now())
   and((p_booking is null and j.next_attempt_at<=now()) or a.booking_id=p_booking)
  order by j.next_attempt_at for update of j skip locked limit p_limit
 loop
  token=gen_random_uuid();
  update private.payment_jobs set lease_token=token,lease_until=now()+interval '90 seconds',attempts=attempts+1 where attempt_id=job.attempt_id;
  result=result||(select jsonb_build_object('attempt',to_jsonb(a),'lease',token,'dispatch_attempt',job.attempts+1)
    from public.payment_attempts a where a.id=job.attempt_id);
 end loop;
 return result;
end;
$$;

create or replace function public.finish_payment_work(p_attempt uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts; b public.bookings; result text:=p_result->>'result'; owned boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 perform 1 from private.payment_jobs where attempt_id=p_attempt and lease_token=p_lease for update;
 if not found then raise exception using errcode='22023',message='Stale lease'; end if;
 select * into strict a from public.payment_attempts where id=p_attempt for update;
 select * into strict b from public.bookings where id=a.booking_id for update;
 if result='creation_rejected' then
  if a.state<>'creating' or a.session_id is not null
   or (select attempts from private.payment_jobs where attempt_id=a.id)<>1
   or p_result->>'error_type' is distinct from 'invalid_request_error'
   or p_result->>'error_param' not in ('allowed_payment_method_types','expires_at','line_items[0][price_data][unit_amount]')
   or p_result->>'environment' is distinct from 'sandbox'
   or (p_result->>'amount')::bigint is distinct from a.amount_kobo or p_result->>'currency' is distinct from a.currency then
   raise exception using errcode='22023',message='Definitive first-dispatch rejection required';
  end if;
  update public.payment_attempts set state='creation_failed',updated_at=now() where id=a.id;
  update public.bookings set state='expired' where id=b.id and state='held';
  update public.allocations set active=false where booking_id=b.id;
  delete from private.payment_jobs where attempt_id=a.id;
  return;
 end if;
 if result not in ('open','paid','expired','refund_pending','refund_failed','refunded','review_required') or result is null then
  raise exception using errcode='22023',message='Invalid result';
 end if;
 if result='review_required' then
  update public.payment_attempts set state='review_required',updated_at=now() where id=a.id;
  delete from private.payment_jobs where attempt_id=a.id;
  return;
 end if;
 if (p_result->>'amount')::bigint is distinct from a.amount_kobo or p_result->>'currency' is distinct from a.currency
   or p_result->>'environment' is distinct from 'sandbox' then
  raise exception using errcode='22023',message='Provider snapshot mismatch';
 end if;
 if result not in ('refund_pending','refund_failed','refunded') then
  if p_result->>'session_id' is null or (a.session_id is not null and a.session_id<>p_result->>'session_id') then
   raise exception using errcode='22023',message='Session mismatch';
  end if;
  update public.payment_attempts set session_id=p_result->>'session_id',
   provider_expires_at=to_timestamp((p_result->>'expires_at')::bigint),updated_at=now() where id=a.id;
 end if;
 if result='open' then
  if a.state not in ('creating','open','review_required') then
   delete from private.payment_jobs where attempt_id=a.id;
   update private.payment_events set state='processed',processed_at=now() where attempt_id=a.id and state='pending'; return;
  end if;
  if p_result->>'checkout_url' is null or p_result->>'checkout_url' !~ '^https://checkout[.]stripe[.]com/' then
   raise exception using errcode='22023',message='Invalid hosted URL';
  end if;
  update public.payment_attempts set state='open',checkout_url=p_result->>'checkout_url' where id=a.id;
  update public.bookings set expires_at=to_timestamp((p_result->>'expires_at')::bigint) where id=b.id;
  update private.payment_jobs set lease_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute',last_error=null where attempt_id=a.id;
 elsif result='paid' then
  if a.state='refunded' then delete from private.payment_jobs where attempt_id=a.id;
   update private.payment_events set state='processed',processed_at=now() where attempt_id=a.id and state='pending'; return; end if;
  if p_result->>'payment_intent_id' is null or (a.payment_intent_id is not null and a.payment_intent_id<>p_result->>'payment_intent_id') then
   raise exception using errcode='22023',message='Payment reference mismatch';
  end if;
  select exists(select 1 from public.allocations where booking_id=b.id and active) and b.state in ('held','confirmed') into owned;
  update public.payment_attempts set payment_intent_id=p_result->>'payment_intent_id',checkout_url=null,
   state=case when owned then 'paid' else 'refund_required' end,
   refund_state=case when owned then 'none' else 'required' end,
   refund_started_at=case when owned then null else coalesce(refund_started_at,now()) end where id=a.id;
  if owned then
   update public.bookings set state='confirmed' where id=b.id;
   delete from private.payment_jobs where attempt_id=a.id;
  else
   update private.payment_jobs set lease_token=null,lease_until=null,next_attempt_at=now(),last_error=null where attempt_id=a.id;
  end if;
 elsif result='expired' then
  if a.state in ('paid','refund_required','refunded') then
   raise exception using errcode='22023',message='Terminal payment cannot regress';
  end if;
  update public.payment_attempts set state='expired',checkout_url=null where id=a.id;
  update public.bookings set state=case when a.cancel_requested then 'released' else 'expired' end where id=b.id and state='held';
  update public.allocations set active=false where booking_id=b.id and b.state='held';
  delete from private.payment_jobs where attempt_id=a.id;
 elsif result in ('refund_pending','refund_failed','refunded') then
  if a.state not in ('refund_required','refunded') or p_result->>'refund_id' is null
   or (a.refund_id is not null and a.refund_id<>p_result->>'refund_id') then
   raise exception using errcode='22023',message='Refund mismatch';
  end if;
  update public.payment_attempts set state=case when result='refunded' then 'refunded' when result='refund_failed' then 'review_required' else 'refund_required' end,
   refund_state=case when result='refunded' then 'succeeded' when result='refund_failed' then 'failed' else 'pending' end,
   refund_id=p_result->>'refund_id',checkout_url=null,updated_at=now() where id=a.id;
  if result='refund_pending' then
   update private.payment_jobs set lease_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute',last_error=null where attempt_id=a.id;
  else delete from private.payment_jobs where attempt_id=a.id; end if;
 end if;
 update private.payment_events set state='processed',processed_at=now() where attempt_id=a.id and state='pending';
end;
$$;
