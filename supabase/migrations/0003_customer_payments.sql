-- M2: the owner approved 40% for NEW quotes after the original NGN 600 proof
-- failed. Never rewrite existing booking snapshots or attach Stripe to old holds.
alter table public.venue_settings alter column deposit_percent set default 40;
update public.venue_settings set deposit_percent=40 where id;
alter table public.bookings add column payment_kind text not null default 'legacy'
  check(payment_kind in ('legacy','checkout'));
alter table public.bookings drop constraint bookings_state_check;
alter table public.bookings add constraint bookings_state_check
  check(state in ('held','released','expired','confirmed','cancelled'));

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  amount_kobo bigint not null check(amount_kobo>0),
  currency text not null check(currency='ngn'),
  state text not null default 'creating' check(state in ('creating','open','paid','expired','refund_required','refunded','review_required')),
  session_id text unique,
  checkout_url text,
  payment_intent_id text unique,
  refund_id text unique,
  refund_state text not null default 'none' check(refund_state in ('none','required','pending','succeeded','failed')),
  refund_started_at timestamptz,
  cancel_requested boolean not null default false,
  requested_expires_at timestamptz not null default now()+interval '35 minutes',
  provider_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from public,anon,authenticated;
grant select on public.payment_attempts to authenticated;
create policy own_payment_attempts on public.payment_attempts for select to authenticated
 using(owner_id=(select auth.uid()) or (select public.is_admin()));

create table private.payment_jobs (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error text check(last_error in ('provider_unavailable','verification_failed','creation_window_elapsed','controlled_failure'))
);
create table private.payment_events (
  event_id text primary key,
  attempt_id uuid not null references public.payment_attempts(id) on delete restrict,
  event_type text not null,
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','processed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table private.payment_jobs enable row level security;
alter table private.payment_events enable row level security;
revoke all on private.payment_jobs,private.payment_events from public,anon,authenticated;

create or replace function private.expire_m1_holds() returns void
language sql security definer set search_path='' as $$
 with expired as (
  update public.bookings set state='expired'
  where payment_kind='legacy' and state='held' and expires_at<=now() returning id
 ) update public.allocations set active=false where booking_id in(select id from expired);
$$;
create or replace function public.resource_availability(p_start timestamptz,p_end timestamptz)
returns table(resource_id uuid,available boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.validate_interval(p_start,p_end);
 return query select r.id,not exists(
  select 1 from public.allocations a left join public.bookings b on b.id=a.booking_id
  where a.resource_id=r.id and a.active and a.period && tstzrange(p_start,p_end,'[)')
   and(a.kind='closure' or b.payment_kind='checkout' or b.expires_at>now())
 ) from public.resources r where r.active;
end;
$$;
create or replace function public.release_hold(p_booking uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.bookings;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in required'; end if;
 select * into b from public.bookings where id=p_booking and(owner_id=auth.uid() or public.is_admin()) for update;
 if not found then raise exception using errcode='42501',message='Hold unavailable'; end if;
 if b.payment_kind='checkout' then raise exception using errcode='22023',message='Payment-aware cancellation required'; end if;
 if b.state='held' then
  update public.bookings set state=case when expires_at<=now() then 'expired' else 'released' end where id=b.id;
  update public.allocations set active=false where booking_id=b.id;
 end if;
end;
$$;

create function public.begin_checkout(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; a public.payment_attempts; expected jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':hold',0));
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

create function public.request_checkout_cancel(p_booking uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in required'; end if;
 -- Job -> attempt is also the worker's lock order.
 perform 1 from private.payment_jobs j join public.payment_attempts p on p.id=j.attempt_id
  where p.booking_id=p_booking and p.owner_id=auth.uid() for update of j;
 select * into a from public.payment_attempts where booking_id=p_booking and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='Checkout unavailable'; end if;
 if a.state not in ('creating','open','review_required') then return; end if;
 update public.payment_attempts set cancel_requested=true,updated_at=now() where id=a.id;
 insert into private.payment_jobs(attempt_id) values(a.id)
  on conflict(attempt_id) do update set next_attempt_at=now();
 -- No allocation release here: only a verified expired/unpaid provider result
 -- permits that, even if the browser timer has ended.
end;
$$;

create function public.claim_payment_work(p_booking uuid default null,p_limit integer default 2)
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
  result=result||(select jsonb_build_object('attempt',to_jsonb(a),'lease',token)
    from public.payment_attempts a where a.id=job.attempt_id);
 end loop;
 return result;
end;
$$;

create function public.finish_payment_work(p_attempt uuid,p_lease uuid,p_result jsonb) returns void
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
  if p_result->>'checkout_url' !~ '^https://checkout[.]stripe[.]com/' then
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

create function public.defer_payment_work(p_attempt uuid,p_lease uuid,p_error text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 if p_error not in ('provider_unavailable','verification_failed','creation_window_elapsed','controlled_failure') or p_error is null then
  raise exception using errcode='22023',message='Safe error code required';
 end if;
 update private.payment_jobs set lease_token=null,lease_until=null,last_error=p_error,
  next_attempt_at=now()+make_interval(secs=>least(900,power(2,least(attempts,10)))::integer)
  where attempt_id=p_attempt and lease_token=p_lease;
end;
$$;

create function public.receive_payment_event(p_event text,p_attempt uuid,p_type text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare existing private.payment_events;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 if p_event !~ '^evt_[A-Za-z0-9]+$' or p_type not in ('checkout.session.completed','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','charge.refunded')
  or not exists(select 1 from public.payment_attempts where id=p_attempt) then
  raise exception using errcode='22023',message='Invalid event';
 end if;
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

-- Operational job looks up opaque credentials from Vault; no secret in cron text.
create function private.invoke_payment_recovery() returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; token text;
begin
 select decrypted_secret into strict endpoint from vault.decrypted_secrets where name='palmsteeze_payment_worker_url';
 select decrypted_secret into strict token from vault.decrypted_secrets where name='palmsteeze_payment_worker_token';
 return net.http_post(url=>endpoint,headers=>jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body=>'{}'::jsonb,timeout_milliseconds=>45000);
end;
$$;
revoke all on function private.invoke_payment_recovery() from public,anon,authenticated;
revoke all on function public.begin_checkout(uuid,timestamptz,timestamptz,uuid,jsonb),public.request_checkout_cancel(uuid),
 public.claim_payment_work(uuid,integer),public.finish_payment_work(uuid,uuid,jsonb),public.defer_payment_work(uuid,uuid,text),
 public.receive_payment_event(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_checkout(uuid,timestamptz,timestamptz,uuid,jsonb),public.request_checkout_cancel(uuid) to authenticated;
grant execute on function public.claim_payment_work(uuid,integer),public.finish_payment_work(uuid,uuid,jsonb),
 public.defer_payment_work(uuid,uuid,text),public.receive_payment_event(text,uuid,text,jsonb) to service_role;
