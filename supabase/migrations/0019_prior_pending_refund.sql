-- A prior provider refund can still reserve funds. Display pending and retain
-- durable retries; no new refund is issued over that uncertain amount.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.record_refund_snapshot(uuid,uuid,bigint,jsonb)'::regprocedure) into definition;
 definition=replace(definition,
  'set collected_kobo=p_collected,refunded_kobo=total where id=a.id returning * into a;',
  'set collected_kobo=p_collected,refunded_kobo=total,refund_state=case when state=''refund_required'' and reserved>0 then ''pending'' when state=''refund_required'' and refund_id is null and reserved=0 and total<p_collected then ''required'' else refund_state end where id=a.id returning * into a;');
 execute definition;
end;
$migration$;
