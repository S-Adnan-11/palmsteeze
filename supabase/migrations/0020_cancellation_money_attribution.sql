-- New approvals may collect more than the minimum deposit. Keep old audit
-- records intact; label new decision money accurately in traceability records.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.admin_decide_cancellation(uuid,boolean,text)'::regprocedure) into definition;
 definition=replace(definition,
  'jsonb_build_object(''request_id'',c.id,''deposit_kobo'',a.amount_kobo)',
  'jsonb_build_object(''request_id'',c.id,''minimum_deposit_kobo'',b.deposit_kobo,''collected_payment_kobo'',a.collected_kobo,''verified_refunded_kobo'',a.refunded_kobo)');
 execute definition;
end;
$migration$;
