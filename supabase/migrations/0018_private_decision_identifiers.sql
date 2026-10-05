-- Customers receive the decision/reason/time, while administrator identity
-- details (including their stable identifier) stay behind guarded admin RPCs.
revoke select on public.cancellation_requests from authenticated;
grant select(id,booking_id,owner_id,reason,state,created_at,decided_at,decision_reason) on public.cancellation_requests to authenticated;
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.request_cancellation(uuid,text)'::regprocedure) into definition;
 definition=replace(definition,'return to_jsonb(c);','return to_jsonb(c)-''decided_by'';');
 execute definition;
end;
$migration$;
