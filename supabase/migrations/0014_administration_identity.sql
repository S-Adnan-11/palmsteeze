-- Private identity attribution belongs to administration, never customer DTOs.
create table private.cancellation_identity (
 request_id uuid primary key references public.cancellation_requests(id) on delete cascade,
 customer jsonb not null, administrator jsonb, decision_at timestamptz
);
alter table private.cancellation_identity enable row level security;
revoke all on private.cancellation_identity from public,anon,authenticated;
alter table public.admin_audit add column actor_snapshot jsonb;

create function private.identity_snapshot(p_user uuid,p_historical boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',p_user,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),case when p_user is null then 'System worker' else 'Name unavailable' end),
 'email',u.email,'captured_at',now(),'historical_identity_unavailable',p_historical)
 from (select 1) seed left join auth.users u on u.id=p_user;
$$;
revoke all on function private.identity_snapshot(uuid,boolean) from public,anon,authenticated;

create function private.capture_cancellation_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into private.cancellation_identity(request_id,customer) values(new.id,private.identity_snapshot(new.owner_id));
 elsif old.state='pending' and new.state in ('approved','rejected') then
  update private.cancellation_identity set administrator=private.identity_snapshot(new.decided_by),decision_at=new.decided_at where request_id=new.id and administrator is null;
 end if;
 return new;
end; $$;
revoke all on function private.capture_cancellation_identity() from public,anon,authenticated;
create trigger capture_cancellation_identity after insert or update on public.cancellation_requests
 for each row execute function private.capture_cancellation_identity();
create function private.capture_audit_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin new.actor_snapshot=private.identity_snapshot(new.actor_id);return new;end; $$;
revoke all on function private.capture_audit_identity() from public,anon,authenticated;
create trigger capture_audit_identity before insert on public.admin_audit for each row execute function private.capture_audit_identity();

-- Historical names/emails were not captured then. Explicitly label today's
-- lookup instead of inventing attribution at an earlier decision time.
insert into private.cancellation_identity(request_id,customer,administrator,decision_at)
 select id,private.identity_snapshot(owner_id,true),case when state<>'pending' then private.identity_snapshot(decided_by,true) end,decided_at from public.cancellation_requests;
update public.admin_audit set actor_snapshot=private.identity_snapshot(actor_id,true) where actor_snapshot is null;

alter function public.admin_snapshot() set schema private;
alter function private.admin_snapshot() rename to admin_snapshot_base;
revoke all on function private.admin_snapshot_base() from public,anon,authenticated;
create function private.enrich_admin_snapshot(p_snapshot jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception using errcode='42501',message='Assigned administrator required';end if;
 return p_snapshot||jsonb_build_object(
 'bookings',(select coalesce(jsonb_agg(b||jsonb_build_object('customer_identity',private.identity_snapshot((b->>'owner_id')::uuid))),'[]') from jsonb_array_elements(p_snapshot->'bookings') b),
 'cancellations',(select coalesce(jsonb_agg(c||jsonb_build_object('customer_identity',i.customer,'administrator_identity',i.administrator,'attribution_decision_at',i.decision_at)),'[]') from jsonb_array_elements(p_snapshot->'cancellations') c left join private.cancellation_identity i on i.request_id=(c->>'id')::uuid));
end; $$;
revoke all on function private.enrich_admin_snapshot(jsonb) from public,anon,authenticated;
create function public.admin_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select private.enrich_admin_snapshot(private.admin_snapshot_base());
$$;
revoke all on function public.admin_snapshot() from public,anon;
grant execute on function public.admin_snapshot() to authenticated;
create or replace function public.admin_booking_snapshot(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=public.admin_snapshot();
 return private.enrich_admin_snapshot(result||jsonb_build_object(
 'bookings',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.bookings b where id=p_booking),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p)-'checkout_url'),'[]') from public.payment_attempts p where booking_id=p_booking),
 'cancellations',(select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc),'[]') from public.cancellation_requests c where booking_id=p_booking)));
end; $$;
