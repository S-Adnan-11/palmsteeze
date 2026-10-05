-- The public integrity wrapper records exactly one closure creation event.
create or replace function public.admin_create_closure(p_resource uuid,p_start timestamptz,p_end timestamptz,p_reason text,p_request uuid) returns uuid
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
 return closure;
end; $$;
