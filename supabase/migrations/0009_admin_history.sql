-- Authenticated customers retain resource names for their historical bookings;
-- anonymous catalogue reads still see only active resources.
create policy historical_resource_names on public.resources for select to authenticated using(
 (select public.is_admin()) or exists(select 1 from public.bookings b where b.resource_id=resources.id and b.owner_id=(select auth.uid())));

-- All authorized closure creation paths, including the preserved M1 endpoint,
-- record traceability without changing the exclusion/adjacency contract.
alter function public.create_closure(uuid,timestamptz,timestamptz,text) rename to create_closure_integrity;
alter function public.create_closure_integrity(uuid,timestamptz,timestamptz,text) set schema private;
revoke all on function private.create_closure_integrity(uuid,timestamptz,timestamptz,text) from public,anon,authenticated,service_role;
create function public.create_closure(p_resource uuid,p_start timestamptz,p_end timestamptz,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 id=private.create_closure_integrity(p_resource,p_start,p_end,p_reason);
 perform private.audit_admin('closure_created',id,btrim(p_reason),jsonb_build_object('resource_id',p_resource,'starts_at',p_start,'ends_at',p_end));
 return id;
end; $$;
revoke all on function public.create_closure(uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.create_closure(uuid,timestamptz,timestamptz,text) to authenticated;

create function public.admin_booking_snapshot(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=public.admin_snapshot(); -- checks explicit role before any reads
 return result||jsonb_build_object(
 'bookings',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.bookings b where id=p_booking),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p)-'checkout_url'),'[]') from public.payment_attempts p where booking_id=p_booking),
 'cancellations',(select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc),'[]') from public.cancellation_requests c where booking_id=p_booking));
end; $$;
revoke all on function public.admin_booking_snapshot(uuid) from public,anon;
grant execute on function public.admin_booking_snapshot(uuid) to authenticated;
