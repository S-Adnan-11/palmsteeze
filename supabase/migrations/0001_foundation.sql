-- M1 only: expirable allocations have no payment attempt or external provider side effect.
-- M2 must replace the M1 expiry contract before attaching any Checkout Session.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists btree_gist with schema extensions;

create table public.venue_settings (
  id boolean primary key default true check (id),
  name text not null default 'PalmSteeze Workspaces',
  district text not null default 'Lekki, Lagos',
  timezone text not null default 'Africa/Lagos' check (timezone = 'Africa/Lagos'),
  currency text not null default 'NGN' check (currency = 'NGN'),
  opens_hour integer not null default 8 check (opens_hour between 0 and 22),
  closes_hour integer not null default 20 check (closes_hour between 1 and 23 and closes_hour > opens_hour),
  open_weekdays integer[] not null default '{1,2,3,4,5,6}' check (open_weekdays <@ array[0,1,2,3,4,5,6]),
  horizon_days integer not null default 30 check (horizon_days between 1 and 365),
  lead_hours integer not null default 1 check (lead_hours between 1 and 72),
  deposit_percent integer not null default 30 check (deposit_percent between 1 and 100),
  hold_minutes integer not null default 30 check (hold_minutes between 1 and 60),
  defaults_proposed boolean not null default true
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('open_desk','quiet_desk','room')),
  seats integer not null check (seats between 1 and 20),
  description text not null,
  active boolean not null default true,
  check (kind = 'room' or seats = 1)
);
create table public.resource_rates (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete restrict,
  effective_at timestamptz not null default now(),
  hourly_kobo bigint not null check (hourly_kobo between 1 and 100000000),
  unique (resource_id, effective_at)
);
create table private.app_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'admin')
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  resource_id uuid not null references public.resources(id) on delete restrict,
  request_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_hours integer not null check (duration_hours between 1 and 23),
  hourly_kobo bigint not null check (hourly_kobo between 1 and 100000000),
  total_kobo bigint not null check (total_kobo = hourly_kobo * duration_hours),
  deposit_percent integer not null check (deposit_percent between 1 and 100),
  deposit_kobo bigint not null check (deposit_kobo = (total_kobo * deposit_percent + 50) / 100),
  balance_kobo bigint not null check (balance_kobo = total_kobo - deposit_kobo),
  currency text not null check (currency = 'NGN'),
  policy_snapshot jsonb not null,
  state text not null default 'held' check (state in ('held','released','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at = duration_hours * interval '1 hour'),
  check (isfinite(starts_at) and isfinite(ends_at) and isfinite(expires_at)),
  unique (owner_id, request_id)
);
create unique index one_unresolved_hold_per_customer on public.bookings(owner_id) where state = 'held';
create index bookings_owner_history on public.bookings(owner_id, created_at desc);
create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete restrict,
  period tstzrange not null,
  kind text not null check (kind in ('hold','closure')),
  booking_id uuid unique references public.bookings(id) on delete restrict,
  reason text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (not isempty(period) and not lower_inf(period) and not upper_inf(period)
    and lower_inc(period) and not upper_inc(period)
    and isfinite(lower(period)) and isfinite(upper(period))),
  check ((kind = 'hold' and booking_id is not null and reason is null)
      or (kind = 'closure' and booking_id is null and reason is not null and length(btrim(reason)) between 1 and 512)),
  constraint allocation_no_overlap exclude using gist
    (resource_id extensions.gist_uuid_ops with =, period with &&) where (active)
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.app_roles where user_id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.venue_settings enable row level security;
alter table public.resources enable row level security;
alter table public.resource_rates enable row level security;
alter table public.bookings enable row level security;
alter table public.allocations enable row level security;
alter table private.app_roles enable row level security;

revoke all on public.venue_settings, public.resources, public.resource_rates, public.bookings, public.allocations from anon, authenticated;
grant select on public.venue_settings, public.resources, public.resource_rates to anon, authenticated;
grant select on public.bookings, public.allocations to authenticated;
create policy public_settings on public.venue_settings for select to anon, authenticated using (true);
create policy public_active_resources on public.resources for select to anon, authenticated using (active);
create policy public_active_rates on public.resource_rates for select to anon, authenticated
  using (exists(select 1 from public.resources where id = resource_id and active));
create policy own_bookings on public.bookings for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy own_allocations on public.allocations for select to authenticated
  using ((select public.is_admin()) or exists(select 1 from public.bookings where id = booking_id and owner_id = (select auth.uid())));

create function private.validate_interval(p_start timestamptz, p_end timestamptz)
returns public.venue_settings language plpgsql stable security definer set search_path = '' as $$
declare v public.venue_settings; s timestamp; e timestamp; n timestamptz := now();
begin
  select * into strict v from public.venue_settings where id;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
      or p_end <= p_start or p_end - p_start < interval '1 hour' then
    raise exception using errcode = '22023', message = 'Invalid booking interval';
  end if;
  s := p_start at time zone v.timezone; e := p_end at time zone v.timezone;
  if s::date <> e::date or date_trunc('hour',s) <> s or date_trunc('hour',e) <> e
      or not (extract(dow from s)::integer = any(v.open_weekdays))
      or extract(hour from s) < v.opens_hour or extract(hour from e) > v.closes_hour
      or p_start < n + make_interval(hours => v.lead_hours)
      or s::date > (n at time zone v.timezone)::date + v.horizon_days then
    raise exception using errcode = '22023', message = 'Choose whole hours within opening hours and booking horizon';
  end if;
  return v;
end;
$$;

create function private.expire_m1_holds() returns void
language sql security definer set search_path = '' as $$
  with expired as (
    update public.bookings set state = 'expired'
    where state = 'held' and expires_at <= now() returning id
  ) update public.allocations set active = false where booking_id in (select id from expired);
$$;
revoke all on function private.validate_interval(timestamptz,timestamptz), private.expire_m1_holds() from public, anon, authenticated;

create function public.quote_resource(p_resource uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.venue_settings; price bigint; hours integer; total bigint; deposit bigint;
begin
  v := private.validate_interval(p_start,p_end);
  select rr.hourly_kobo into price from public.resource_rates rr
  join public.resources r on r.id = rr.resource_id and r.active
  where r.id = p_resource and rr.effective_at <= now() order by rr.effective_at desc limit 1;
  if price is null then raise exception using errcode = '22023', message = 'Space is unavailable'; end if;
  hours := extract(epoch from p_end - p_start)::integer / 3600;
  total := price * hours; deposit := (total * v.deposit_percent + 50) / 100;
  return jsonb_build_object('resource_id',p_resource,'starts_at',p_start,'ends_at',p_end,
    'duration_hours',hours,'hourly_kobo',price,'total_kobo',total,'deposit_percent',v.deposit_percent,
    'deposit_kobo',deposit,'balance_kobo',total - deposit,'currency',v.currency,
    'policy_snapshot',to_jsonb(v) - 'id');
end;
$$;

create function public.resource_availability(p_start timestamptz,p_end timestamptz)
returns table(resource_id uuid, available boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.validate_interval(p_start,p_end);
  return query select r.id, not exists(
    select 1 from public.allocations a left join public.bookings b on b.id = a.booking_id
    where a.resource_id = r.id and a.active and a.period && tstzrange(p_start,p_end,'[)')
      and (a.kind = 'closure' or b.expires_at > now())
  ) from public.resources r where r.active;
end;
$$;

create function public.create_hold(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v public.venue_settings; q jsonb; b public.bookings;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in required'; end if;
  if p_request is null then raise exception using errcode = '22023', message = 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':hold',0));
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

create function public.release_hold(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in required'; end if;
  select * into b from public.bookings where id = p_booking and (owner_id = auth.uid() or public.is_admin()) for update;
  if not found then raise exception using errcode = '42501', message = 'Hold is unavailable'; end if;
  if b.state = 'held' then
    update public.bookings set state = case when expires_at <= now() then 'expired' else 'released' end where id = b.id;
    update public.allocations set active = false where booking_id = b.id;
  end if;
end;
$$;

create function public.create_closure(p_resource uuid,p_start timestamptz,p_end timestamptz,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare allocation uuid;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Administrator required'; end if;
  if p_start is null or p_end is null or p_end <= p_start or not isfinite(p_start) or not isfinite(p_end)
      or p_reason is null or length(btrim(p_reason)) not between 1 and 512 then
    raise exception using errcode = '22023', message = 'Invalid closure interval or reason';
  end if;
  perform private.expire_m1_holds();
  perform 1 from public.resources where id = p_resource and active for share;
  if not found then raise exception using errcode = '22023', message = 'Space is unavailable'; end if;
  insert into public.allocations(resource_id,period,kind,reason)
    values(p_resource,tstzrange(p_start,p_end,'[)'),'closure',btrim(p_reason)) returning id into allocation;
  return allocation;
end;
$$;

revoke all on function public.quote_resource(uuid,timestamptz,timestamptz),
  public.resource_availability(timestamptz,timestamptz),
  public.create_hold(uuid,timestamptz,timestamptz,uuid),public.release_hold(uuid),
  public.create_closure(uuid,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.quote_resource(uuid,timestamptz,timestamptz),
  public.resource_availability(timestamptz,timestamptz) to anon, authenticated;
grant execute on function public.create_hold(uuid,timestamptz,timestamptz,uuid),
  public.release_hold(uuid),public.create_closure(uuid,timestamptz,timestamptz,text) to authenticated;
-- No direct writes or role assignment RPC for customers; service secrets are not used by application routes.
