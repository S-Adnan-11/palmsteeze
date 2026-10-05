-- Serialize same-resource allocation inserts before the exclusion check.
-- The GiST constraint remains the shared booking/closure integrity model.
create or replace function public.create_hold(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v public.venue_settings; q jsonb; b public.bookings;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in required'; end if;
  if p_request is null then raise exception using errcode = '22023', message = 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':hold',0));
  perform pg_advisory_xact_lock(hashtextextended(p_resource::text || ':allocation',0));
  perform private.expire_m1_holds();
  select * into b from public.bookings where owner_id = uid and request_id = p_request;
  if found then
    if b.resource_id <> p_resource or b.starts_at <> p_start or b.ends_at <> p_end or b.state <> 'held'
        or p_resource is null or p_start is null or p_end is null then
      raise exception using errcode = '22023', message = 'Request ID cannot be reused for changed or expired work';
    end if;
    return to_jsonb(b);
  end if;
  -- Keep configuration and resource status stable until this transaction commits.
  select * into strict v from public.venue_settings where id for share;
  perform 1 from public.resources where id = p_resource and active for share;
  if not found then raise exception using errcode = '22023', message = 'Space is unavailable'; end if;
  q := public.quote_resource(p_resource,p_start,p_end);
  if exists(select 1 from public.bookings where owner_id = uid and state = 'held') then
    raise exception using errcode = '23505', message = 'Release your existing hold before starting another';
  end if;
  insert into public.bookings(owner_id,resource_id,request_id,starts_at,ends_at,duration_hours,
    hourly_kobo,total_kobo,deposit_percent,deposit_kobo,balance_kobo,currency,policy_snapshot,expires_at)
  values(uid,p_resource,p_request,p_start,p_end,(q->>'duration_hours')::integer,
    (q->>'hourly_kobo')::bigint,(q->>'total_kobo')::bigint,(q->>'deposit_percent')::integer,
    (q->>'deposit_kobo')::bigint,(q->>'balance_kobo')::bigint,q->>'currency',q->'policy_snapshot',
    now() + make_interval(mins => v.hold_minutes)) returning * into b;
  insert into public.allocations(resource_id,period,kind,booking_id)
    values(p_resource,tstzrange(p_start,p_end,'[)'),'hold',b.id);
  return to_jsonb(b);
end;
$$;

create or replace function public.create_closure(p_resource uuid,p_start timestamptz,p_end timestamptz,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare allocation uuid;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Administrator required'; end if;
  if p_start is null or p_end is null or p_end <= p_start or not isfinite(p_start) or not isfinite(p_end)
      or p_reason is null or length(btrim(p_reason)) not between 1 and 512 then
    raise exception using errcode = '22023', message = 'Invalid closure interval or reason';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_resource::text || ':allocation',0));
  perform private.expire_m1_holds();
  perform 1 from public.resources where id = p_resource and active for share;
  if not found then raise exception using errcode = '22023', message = 'Space is unavailable'; end if;
  insert into public.allocations(resource_id,period,kind,reason)
    values(p_resource,tstzrange(p_start,p_end,'[)'),'closure',btrim(p_reason)) returning id into allocation;
  return allocation;
end;
$$;

create or replace function public.begin_checkout(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; a public.payment_attempts; expected jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':hold',0));
 perform pg_advisory_xact_lock(hashtextextended(p_resource::text||':allocation',0));
 select * into b from public.bookings where owner_id=auth.uid() and request_id=p_request;
 if found then
  if b.payment_kind<>'checkout' or b.resource_id is distinct from p_resource
    or b.starts_at is distinct from p_start or b.ends_at is distinct from p_end then
   raise exception using errcode='22023',message='Request cannot be reused';
  end if;
  select * into strict a from public.payment_attempts where booking_id=b.id;
  return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(a));
 end if;
 -- create_hold owns the authoritative validation, quote snapshot and exclusion
 -- insertion. This wrapper commits the payment attempt/job in the SAME transaction.
 perform public.create_hold(p_resource,p_start,p_end,p_request);
 select * into strict b from public.bookings where owner_id=auth.uid() and request_id=p_request;
 expected=jsonb_build_object('hourly_kobo',b.hourly_kobo,'total_kobo',b.total_kobo,
  'deposit_percent',b.deposit_percent,'deposit_kobo',b.deposit_kobo,'balance_kobo',b.balance_kobo);
 if p_expected is distinct from expected then
  raise exception using errcode='P0001',message='Quote changed; review again';
 end if;
 update public.bookings set payment_kind='checkout' where id=b.id returning * into b;
 insert into public.payment_attempts(booking_id,owner_id,amount_kobo,currency)
  values(b.id,b.owner_id,b.deposit_kobo,lower(b.currency)) returning * into a;
 insert into private.payment_jobs(attempt_id) values(a.id);
 return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(a));
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
   delete from private.payment_jobs where attempt_id=a.id; return;
  end if;
  if p_result->>'checkout_url' is null or p_result->>'checkout_url' !~ '^https://checkout[.]stripe[.]com/' then
   raise exception using errcode='22023',message='Invalid hosted URL';
  end if;
  update public.payment_attempts set state='open',checkout_url=p_result->>'checkout_url' where id=a.id;
  update public.bookings set expires_at=to_timestamp((p_result->>'expires_at')::bigint) where id=b.id;
  update private.payment_jobs set lease_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute',last_error=null where attempt_id=a.id;
 elsif result='paid' then
  if a.state='refunded' then delete from private.payment_jobs where attempt_id=a.id; return; end if;
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
