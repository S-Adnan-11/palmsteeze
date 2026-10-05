-- Configurable requested Checkout lifetime includes five minutes of setup grace.
-- Provider-returned expiry remains authoritative; old snapshots stay unchanged.
alter table public.venue_settings add column checkout_minutes integer not null default 35
 check(checkout_minutes between 30 and 60);
create table public.cancellation_requests (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.bookings(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 1 and 512),
 state text not null default 'pending' check(state in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create unique index one_pending_cancellation on public.cancellation_requests(booking_id) where state='pending';
alter table public.cancellation_requests enable row level security;
revoke all on public.cancellation_requests from public,anon,authenticated;
grant select on public.cancellation_requests to authenticated;
create policy own_cancellation_requests on public.cancellation_requests for select to authenticated
 using(owner_id=(select auth.uid()) or (select public.is_admin()));
create function public.request_cancellation(p_booking uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings; c public.cancellation_requests;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in required'; end if;
 select * into b from public.bookings where id=p_booking and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='Booking unavailable'; end if;
 if b.state<>'confirmed' or b.starts_at<=now() or not exists(select 1 from public.payment_attempts where booking_id=b.id and state='paid')
  or p_reason is null or length(btrim(p_reason)) not between 1 and 512 then
  raise exception using errcode='22023',message='Confirmed future booking and reason required';
 end if;
 select * into c from public.cancellation_requests where booking_id=b.id and state='pending';
 if found then return to_jsonb(c); end if;
 insert into public.cancellation_requests(booking_id,owner_id,reason) values(b.id,b.owner_id,btrim(p_reason)) returning * into c;
 -- Requesting never frees inventory, cancels a booking or initiates a refund.
 -- Administrator decisions/refund screens are M3.
 return to_jsonb(c);
end;
$$;
revoke all on function public.request_cancellation(uuid,text) from public,anon;
grant execute on function public.request_cancellation(uuid,text) to authenticated;
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
 insert into public.payment_attempts(booking_id,owner_id,amount_kobo,currency,requested_expires_at)
  values(b.id,b.owner_id,b.deposit_kobo,lower(b.currency),now()+make_interval(mins=>(b.policy_snapshot->>'checkout_minutes')::integer)) returning * into a;
 insert into private.payment_jobs(attempt_id) values(a.id);
 return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(a));
end;
$$;
