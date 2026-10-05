-- A request to retry a failed local refund must not remain latent after the
-- provider instead verifies a pending/successful result. Consume that request;
-- a later genuine failure requires another deliberate administrator action.
create or replace function public.finish_payment_work(p_attempt uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.payment_attempts; current_payment public.payment_attempts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 select * into strict prior from public.payment_attempts where id=p_attempt;
 perform private.finish_payment_work_m2(p_attempt,p_lease,p_result);
 if p_result->>'result' in ('refund_pending','refunded') then
  update public.payment_attempts set refund_retry_requested=false where id=p_attempt;
 end if;
 select * into strict current_payment from public.payment_attempts where id=p_attempt;
 if p_result->>'result' in ('refund_pending','refund_failed','refunded') then
  update public.refund_operations set refund_id=current_payment.refund_id,
   state=case current_payment.refund_state when 'succeeded' then 'succeeded' when 'failed' then 'failed' else 'pending' end,updated_at=now()
   where attempt_id=p_attempt and generation=current_payment.refund_generation;
 end if;
 if prior.state is distinct from current_payment.state or prior.refund_state is distinct from current_payment.refund_state then
  perform private.audit_admin('payment_reconciled',current_payment.booking_id,'Verified backend payment/refund transition',jsonb_build_object('payment_before',prior.state,'payment_after',current_payment.state,'refund_before',prior.refund_state,'refund_after',current_payment.refund_state,'generation',current_payment.refund_generation));
 end if;
end; $$;
revoke all on function public.finish_payment_work(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_payment_work(uuid,uuid,jsonb) to service_role;
