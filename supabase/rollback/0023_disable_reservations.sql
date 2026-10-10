-- Emergency fail-closed rollback; DOES NOT reopen original unguarded RPCs.
begin;
revoke all on function public.create_verified_hold(uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.begin_verified_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint,text) from public,anon,authenticated,service_role;
commit;
-- Retain records, configuration, migration checksums and old revocations.
-- Recover with reviewed forward migration; never reset or delete history.
