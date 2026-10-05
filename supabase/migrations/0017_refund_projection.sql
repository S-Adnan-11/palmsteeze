-- A verified paid Session can have provider refunds before cancellation.
-- Persist its complete receipts without inventing a cancellation operation.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.record_refund_snapshot(uuid,uuid,bigint,jsonb)'::regprocedure) into definition;
 definition=replace(definition,
  'if not found then raise exception using errcode=''22023'',message=''Refund operation required'';end if;',
  'if not found then return to_jsonb(a)||jsonb_build_object(''pending_refund_kobo'',reserved);end if;');
 execute definition;
end;
$migration$;
