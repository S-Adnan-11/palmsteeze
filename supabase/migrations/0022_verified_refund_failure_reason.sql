-- Retain only bounded provider failure codes, never arbitrary messages/PII.
alter table public.payment_refund_receipts add column failure_reason text check(failure_reason is null or failure_reason in ('charge_for_pending_refund_disputed','declined','expired_or_canceled_card','insufficient_funds','lost_or_stolen_card','merchant_request','unknown'));
alter table public.refund_operations add column provider_failure_reason text check(provider_failure_reason is null or provider_failure_reason in ('charge_for_pending_refund_disputed','declined','expired_or_canceled_card','insufficient_funds','lost_or_stolen_card','merchant_request','unknown'));
alter function public.record_refund_snapshot(uuid,uuid,bigint,jsonb) set schema private;
alter function private.record_refund_snapshot(uuid,uuid,bigint,jsonb) rename to record_refund_snapshot_base;
revoke all on function private.record_refund_snapshot_base(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function public.record_refund_snapshot(p_attempt uuid,p_lease uuid,p_collected bigint,p_refunds jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;r jsonb;reason text;
begin
 result=private.record_refund_snapshot_base(p_attempt,p_lease,p_collected,p_refunds);
 for r in select value from jsonb_array_elements(p_refunds) loop
  reason=case when r->>'status' in ('failed','canceled') then case when r->>'failure_reason' in ('charge_for_pending_refund_disputed','declined','expired_or_canceled_card','insufficient_funds','lost_or_stolen_card','merchant_request','unknown') then r->>'failure_reason' else 'unknown' end else null end;
  update public.payment_refund_receipts set failure_reason=reason where attempt_id=p_attempt and refund_id=r->>'id';
  update public.refund_operations set provider_failure_reason=reason where attempt_id=p_attempt and refund_id=r->>'id';
 end loop;
 return result;
end; $$;
revoke all on function public.record_refund_snapshot(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.record_refund_snapshot(uuid,uuid,bigint,jsonb) to service_role;
