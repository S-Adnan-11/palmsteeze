-- Forward correction: the preserved create_hold implementation returns JSONB.
-- The first wrapper's composite return caused 42804 and rolled back all effects.
-- Keep old entry points revoked; change only the new guarded wrapper's return.
drop function public.create_verified_hold(uuid,timestamptz,timestamptz,uuid,text);
create function public.create_verified_hold(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_reservation_authorization(p_capability,'hold',p_resource,p_start,p_end,p_request,null,null);
 return public.create_hold(p_resource,p_start,p_end,p_request);
end; $$;
revoke all on function public.create_verified_hold(uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_verified_hold(uuid,timestamptz,timestamptz,uuid,text) to authenticated;
