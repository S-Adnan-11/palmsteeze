-- Explicit assigned roles only. No direct administration table writes.
create table public.admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id) on delete set null,
 action text not null, target_id uuid, reason text not null,
 changes jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public,anon,authenticated;
grant select on public.admin_audit to authenticated;
create policy assigned_admin_audit on public.admin_audit for select to authenticated using((select public.is_admin()));
create function private.audit_admin(p_action text,p_target uuid,p_reason text,p_changes jsonb default '{}') returns void
language sql security definer set search_path='' as $$
 insert into public.admin_audit(actor_id,action,target_id,reason,changes) values(auth.uid(),p_action,p_target,p_reason,p_changes);
$$;
revoke all on function private.audit_admin(text,uuid,text,jsonb) from public,anon,authenticated;
create function private.require_admin(p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception using errcode='42501',message='Assigned administrator required'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 512 then raise exception using errcode='22023',message='A reason of 1 to 512 characters is required'; end if;
end; $$;
revoke all on function private.require_admin(text) from public,anon,authenticated;

alter table public.cancellation_requests add column decided_at timestamptz,
 add column decided_by uuid references auth.users(id) on delete set null,
 add column decision_reason text;
alter table public.payment_attempts add column refund_generation integer not null default 0 check(refund_generation>=0),
 add column refund_retry_requested boolean not null default false;
create table public.refund_operations (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.payment_attempts(id) on delete restrict,
 generation integer not null check(generation>=0), refund_id text unique,
 state text not null default 'requested' check(state in ('requested','pending','succeeded','failed')),
 amount_kobo bigint not null check(amount_kobo>0), currency text not null check(currency='ngn'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(attempt_id,generation)
);
alter table public.refund_operations enable row level security;
revoke all on public.refund_operations from public,anon,authenticated;
grant select on public.refund_operations to authenticated;
create policy own_refund_operations on public.refund_operations for select to authenticated using(
 (select public.is_admin()) or exists(select 1 from public.payment_attempts a where a.id=attempt_id and a.owner_id=(select auth.uid())));

create function public.admin_decide_cancellation(p_request uuid,p_approve boolean,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests; b public.bookings; a public.payment_attempts; desired text;
begin
 perform private.require_admin(p_reason);
 if p_approve is null then raise exception using errcode='22023',message='Decision required'; end if;
 select * into c from public.cancellation_requests where id=p_request;
 if not found then raise exception using errcode='22023',message='Cancellation request unavailable'; end if;
 -- Job -> payment -> booking -> cancellation follows the worker lock order.
 perform 1 from private.payment_jobs j join public.payment_attempts a on a.id=j.attempt_id where a.booking_id=c.booking_id for update of j;
 select * into strict a from public.payment_attempts where booking_id=c.booking_id for update;
 select * into strict b from public.bookings where id=c.booking_id for update;
 select * into strict c from public.cancellation_requests where id=p_request for update;
 desired=case when p_approve then 'approved' else 'rejected' end;
 if c.state=desired then return b.id; end if;
 if c.state<>'pending' or b.state<>'confirmed' or a.state<>'paid' or a.payment_intent_id is null then
  raise exception using errcode='22023',message='Pending request and verified paid booking required';
 end if;
 update public.cancellation_requests set state=desired,decided_at=now(),decided_by=auth.uid(),decision_reason=btrim(p_reason) where id=c.id;
 if p_approve then
  update public.bookings set state='cancelled' where id=b.id;
  update public.allocations set active=false where booking_id=b.id;
  update public.payment_attempts set state='refund_required',refund_state='required',refund_started_at=coalesce(refund_started_at,now()),updated_at=now() where id=a.id;
  insert into public.refund_operations(attempt_id,generation,amount_kobo,currency) values(a.id,a.refund_generation,a.amount_kobo,a.currency) on conflict(attempt_id,generation) do nothing;
  insert into private.payment_jobs(attempt_id) values(a.id) on conflict(attempt_id) do update set next_attempt_at=now();
 end if;
 perform private.audit_admin('cancellation_'||desired,b.id,btrim(p_reason),jsonb_build_object('request_id',c.id,'deposit_kobo',a.amount_kobo));
 return b.id;
end; $$;

create function public.admin_queue_recovery(p_booking uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 perform private.require_admin(p_reason);
 perform 1 from private.payment_jobs j join public.payment_attempts p on p.id=j.attempt_id where p.booking_id=p_booking for update of j;
 select * into a from public.payment_attempts where booking_id=p_booking for update;
 if not found then raise exception using errcode='22023',message='Payment attempt unavailable'; end if;
 if a.state in ('paid','refunded','expired','creation_failed') then return p_booking; end if;
 if a.state='review_required' then
  if a.refund_id is not null and a.refund_state='failed' then
   update public.payment_attempts set state='refund_required',refund_retry_requested=true,updated_at=now() where id=a.id;
  elsif a.session_id is not null then
   update public.payment_attempts set state=case when a.refund_state in ('required','pending') then 'refund_required' else 'open' end,updated_at=now() where id=a.id;
  else raise exception using errcode='22023',message='Unknown provider reference requires investigation; creating a new payment is unsafe'; end if;
 end if;
 insert into private.payment_jobs(attempt_id) values(a.id) on conflict(attempt_id) do update set next_attempt_at=now();
 perform private.audit_admin('recovery_requested',p_booking,btrim(p_reason),jsonb_build_object('payment_state',a.state,'refund_state',a.refund_state));
 return p_booking;
end; $$;

-- A replacement refund generation is possible only after the trusted worker
-- retrieves the known previous refund and verifies that it failed/cancelled.
create function public.prepare_refund_operation(p_attempt uuid,p_lease uuid,p_failed jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 perform 1 from private.payment_jobs where attempt_id=p_attempt and lease_token=p_lease for update;
 if not found then raise exception using errcode='22023',message='Stale lease'; end if;
 select * into strict a from public.payment_attempts where id=p_attempt for update;
 if a.state<>'refund_required' then raise exception using errcode='22023',message='Refund work required'; end if;
 if p_failed is not null then
  if not a.refund_retry_requested or a.refund_id is null or p_failed->>'id' is distinct from a.refund_id
   or p_failed->>'status' not in ('failed','canceled') or (p_failed->>'amount')::bigint is distinct from a.amount_kobo
   or p_failed->>'currency' is distinct from a.currency or p_failed->>'payment_intent' is distinct from a.payment_intent_id
   or p_failed->>'environment' is distinct from 'sandbox' then raise exception using errcode='22023',message='Verified failed prior refund required'; end if;
  update public.refund_operations set state='failed',refund_id=a.refund_id,updated_at=now() where attempt_id=a.id and generation=a.refund_generation;
  update public.payment_attempts set refund_generation=refund_generation+1,refund_id=null,refund_retry_requested=false,refund_state='required',refund_started_at=now(),updated_at=now() where id=a.id returning * into a;
  perform private.audit_admin('failed_refund_retry_prepared',a.booking_id,'Backend verified prior failed refund',jsonb_build_object('generation',a.refund_generation));
 end if;
 insert into public.refund_operations(attempt_id,generation,amount_kobo,currency,refund_id)
 values(a.id,a.refund_generation,a.amount_kobo,a.currency,a.refund_id) on conflict(attempt_id,generation) do nothing;
 return to_jsonb(a);
end; $$;
revoke all on function public.prepare_refund_operation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_refund_operation(uuid,uuid,jsonb) to service_role;

create function public.admin_update_resource(p_resource uuid,p_name text,p_description text,p_active boolean,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.resources; affected jsonb;
begin
 perform private.require_admin(p_reason);
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_description is null or length(btrim(p_description)) not between 1 and 1000 or p_active is null then raise exception using errcode='22023',message='Valid name, description and active flag required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_resource::text||':allocation',0));
 select * into r from public.resources where id=p_resource for update;
 if not found then raise exception using errcode='22023',message='Resource unavailable'; end if;
 if not p_active then
  select coalesce(jsonb_agg(jsonb_build_object('bookingId',a.booking_id,'allocationId',a.id,'kind',a.kind)), '[]') into affected from public.allocations a where resource_id=p_resource and active and upper(period)>now();
  if jsonb_array_length(affected)>0 then raise exception using errcode='23P01',message='Active allocations prevent archiving',detail=affected::text; end if;
 end if;
 update public.resources set name=btrim(p_name),description=btrim(p_description),active=p_active where id=p_resource;
 perform private.audit_admin('resource_updated',p_resource,btrim(p_reason),jsonb_build_object('before',to_jsonb(r),'after',jsonb_build_object('name',btrim(p_name),'description',btrim(p_description),'active',p_active)));
 return p_resource;
end; $$;
create function public.admin_schedule_rate(p_resource uuid,p_effective timestamptz,p_hourly bigint,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare rate uuid;
begin
 perform private.require_admin(p_reason);
 if p_effective is null or not isfinite(p_effective) or p_effective<=now() or p_hourly is null or p_hourly not between 1 and 100000000 then raise exception using errcode='22023',message='Future effective time and positive integer kobo required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_resource::text||':allocation',0));
 if not exists(select 1 from public.resources where id=p_resource) then raise exception using errcode='22023',message='Resource unavailable'; end if;
 select id into rate from public.resource_rates where resource_id=p_resource and effective_at=p_effective and hourly_kobo=p_hourly;
 if found then return rate; end if;
 insert into public.resource_rates(resource_id,effective_at,hourly_kobo) values(p_resource,p_effective,p_hourly) returning id into rate;
 perform private.audit_admin('future_rate_scheduled',p_resource,btrim(p_reason),jsonb_build_object('rate_id',rate,'effective_at',p_effective,'hourly_kobo',p_hourly));
 return rate;
end; $$;
create function public.admin_update_hours(p_open integer,p_close integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare affected jsonb; r uuid; old public.venue_settings;
begin
 perform private.require_admin(p_reason);
 if p_open is null or p_close is null or p_open<0 or p_close>23 or p_close<=p_open then raise exception using errcode='22023',message='Valid whole opening and closing hours required'; end if;
 for r in select id from public.resources order by id loop perform pg_advisory_xact_lock(hashtextextended(r::text||':allocation',0)); end loop;
 select * into strict old from public.venue_settings where id for update;
 select coalesce(jsonb_agg(jsonb_build_object('bookingId',b.id,'resourceId',b.resource_id)), '[]') into affected from public.bookings b join public.allocations a on a.booking_id=b.id
 where a.active and b.ends_at>now() and (extract(hour from b.starts_at at time zone 'Africa/Lagos')<p_open or extract(hour from b.ends_at at time zone 'Africa/Lagos')>p_close);
 if jsonb_array_length(affected)>0 then raise exception using errcode='23P01',message='Bookings prevent reduced hours',detail=affected::text; end if;
 update public.venue_settings set opens_hour=p_open,closes_hour=p_close where id;
 perform private.audit_admin('hours_updated',null,btrim(p_reason),jsonb_build_object('old_open',old.opens_hour,'old_close',old.closes_hour,'new_open',p_open,'new_close',p_close));
end; $$;

alter table public.allocations add column admin_request_id uuid unique;
create function public.admin_create_closure(p_resource uuid,p_start timestamptz,p_end timestamptz,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.allocations; affected jsonb; closure uuid;
begin
 perform private.require_admin(p_reason);
 if p_request is null or p_start is null or p_end is null or p_end<=p_start or not isfinite(p_start) or not isfinite(p_end) then raise exception using errcode='22023',message='Valid request and finite interval required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_resource::text||':allocation',0));
 select * into existing from public.allocations where admin_request_id=p_request;
 if found then
  if existing.resource_id is distinct from p_resource or existing.period<>tstzrange(p_start,p_end,'[)') or existing.reason<>btrim(p_reason) then raise exception using errcode='22023',message='Request cannot be reused'; end if;
  return existing.id;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('bookingId',booking_id,'allocationId',id,'kind',kind)), '[]') into affected from public.allocations where resource_id=p_resource and active and period&&tstzrange(p_start,p_end,'[)');
 if jsonb_array_length(affected)>0 then raise exception using errcode='23P01',message='Closure conflicts with active allocations',detail=affected::text; end if;
 closure=public.create_closure(p_resource,p_start,p_end,p_reason);
 update public.allocations set admin_request_id=p_request where id=closure;
 perform private.audit_admin('closure_created',closure,btrim(p_reason),jsonb_build_object('resource_id',p_resource,'starts_at',p_start,'ends_at',p_end));
 return closure;
end; $$;
create function public.admin_remove_closure(p_closure uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.allocations;
begin
 perform private.require_admin(p_reason);
 select * into a from public.allocations where id=p_closure and kind='closure';
 if not found then raise exception using errcode='22023',message='Closure unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.resource_id::text||':allocation',0));
 select * into strict a from public.allocations where id=p_closure for update;
 if not a.active then return a.id; end if;
 update public.allocations set active=false where id=a.id;
 perform private.audit_admin('closure_removed',a.id,btrim(p_reason),jsonb_build_object('resource_id',a.resource_id));
 return a.id;
end; $$;

create function public.admin_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception using errcode='42501',message='Assigned administrator required'; end if;
 return jsonb_build_object(
 'metrics',jsonb_build_object('confirmed_bookings',(select count(*) from public.bookings where state='confirmed'),
 'confirmed_value_kobo',(select coalesce(sum(total_kobo),0) from public.bookings where state='confirmed'),
 'received_deposits_kobo',(select coalesce(sum(amount_kobo),0) from public.payment_attempts where payment_intent_id is not null),
 'successful_refunds_kobo',(select coalesce(sum(amount_kobo),0) from public.payment_attempts where refund_state='succeeded'),
 'pending_cancellations',(select count(*) from public.cancellation_requests where state='pending'),
 'recovery_cases',(select count(*) from public.payment_attempts where state in ('creating','open','refund_required','review_required'))),
 'settings',(select to_jsonb(v) from public.venue_settings v),
 'resources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.code),'[]') from public.resources r),
 'rates',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from public.resource_rates order by effective_at desc limit 150) r),
 'bookings',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from(select * from public.bookings order by created_at desc limit 100) b),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p)-'checkout_url'),'[]') from(select * from public.payment_attempts order by created_at desc limit 100) p),
 'cancellations',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from(select * from public.cancellation_requests order by created_at desc limit 100) c),
 'closures',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'resource_id',resource_id,'starts_at',lower(period),'ends_at',upper(period),'reason',reason,'active',active)),'[]') from(select * from public.allocations where kind='closure' order by created_at desc limit 100) a),
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('attempt_id',attempt_id,'attempts',attempts,'next_attempt_at',next_attempt_at,'last_error',last_error,'leased',lease_until>now())),'[]') from(select * from private.payment_jobs order by next_attempt_at limit 100) j),
 'refunds',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from public.refund_operations order by created_at desc limit 100) r),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from(select * from public.admin_audit order by created_at desc limit 100) a));
end; $$;

revoke all on function public.admin_decide_cancellation(uuid,boolean,text),public.admin_queue_recovery(uuid,text),public.admin_update_resource(uuid,text,text,boolean,text),public.admin_schedule_rate(uuid,timestamptz,bigint,text),public.admin_update_hours(integer,integer,text),public.admin_create_closure(uuid,timestamptz,timestamptz,text,uuid),public.admin_remove_closure(uuid,text),public.admin_snapshot() from public,anon;
grant execute on function public.admin_decide_cancellation(uuid,boolean,text),public.admin_queue_recovery(uuid,text),public.admin_update_resource(uuid,text,text,boolean,text),public.admin_schedule_rate(uuid,timestamptz,bigint,text),public.admin_update_hours(integer,integer,text),public.admin_create_closure(uuid,timestamptz,timestamptz,text,uuid),public.admin_remove_closure(uuid,text),public.admin_snapshot() to authenticated;

-- Preserve the verified M2 transition implementation behind an audited wrapper.
alter function public.finish_payment_work(uuid,uuid,jsonb) rename to finish_payment_work_m2;
alter function public.finish_payment_work_m2(uuid,uuid,jsonb) set schema private;
revoke all on function private.finish_payment_work_m2(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.finish_payment_work(p_attempt uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.payment_attempts; current_payment public.payment_attempts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 select * into strict prior from public.payment_attempts where id=p_attempt;
 perform private.finish_payment_work_m2(p_attempt,p_lease,p_result);
 select * into strict current_payment from public.payment_attempts where id=p_attempt;
 if p_result->>'result' in ('refund_pending','refund_failed','refunded') then
  update public.refund_operations set refund_id=current_payment.refund_id,
   state=case current_payment.refund_state when 'succeeded' then 'succeeded' when 'failed' then 'failed' else 'pending' end,updated_at=now()
   where attempt_id=p_attempt and generation=current_payment.refund_generation;
 end if;
 if prior.state is distinct from current_payment.state or prior.refund_state is distinct from current_payment.refund_state then
  perform private.audit_admin('payment_reconciled',current_payment.booking_id,'Verified backend payment/refund transition',jsonb_build_object('payment_before',prior.state,'payment_after',current_payment.state,'refund_before',prior.refund_state,'refund_after',current_payment.refund_state,'generation',current_payment.refund_generation));
 end if;
end; $$;
revoke all on function public.finish_payment_work(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_payment_work(uuid,uuid,jsonb) to service_role;
