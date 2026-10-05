-- Finish duplicate/out-of-order receipts even after a terminal result.
create or replace function public.finish_payment_work(p_attempt uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts; b public.bookings; result text:=p_result->>'result'; owned boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 perform 1 from private.payment_jobs where attempt_id=p_attempt and lease_token=p_lease for update;
 if not found then raise exception using errcode='22023',message='Stale lease'; end if;
 select * into strict a from public.payment_attempts where id=p_attempt for update;
 select * into strict b from public.bookings where id=a.booking_id for update;
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

create or replace function public.receive_payment_event(p_event text,p_attempt uuid,p_type text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare existing private.payment_events;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 if p_event !~ '^evt_[A-Za-z0-9]+$' or p_type not in ('checkout.session.completed','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','charge.refunded')
  or not exists(select 1 from public.payment_attempts where id=p_attempt) then
  raise exception using errcode='22023',message='Invalid event';
 end if;
 -- Use job -> event lock order, matching finish_payment_work. Replayed signed
 -- events may queue an extra bounded reconciliation, but never regress state.
 insert into private.payment_jobs(attempt_id) values(p_attempt)
  on conflict(attempt_id) do update set next_attempt_at=now();
 insert into private.payment_events(event_id,attempt_id,event_type,payload) values(p_event,p_attempt,p_type,p_payload)
  on conflict(event_id) do nothing;
 select * into strict existing from private.payment_events where event_id=p_event;
 if existing.attempt_id<>p_attempt or existing.event_type<>p_type then
  raise exception using errcode='22023',message='Event identity mismatch';
 end if;
 if existing.state='pending' then
  insert into private.payment_jobs(attempt_id) values(p_attempt)
   on conflict(attempt_id) do update set next_attempt_at=now();
 end if;
end;
$$;
