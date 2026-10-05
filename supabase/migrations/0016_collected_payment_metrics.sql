-- Overview counts use verified collected/refunded amounts, including any prior
-- partial provider refund; labels need not assume every payment was a deposit.
create or replace function public.admin_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=private.enrich_admin_snapshot(private.admin_snapshot_base());
 return jsonb_set(result,'{metrics}',(result->'metrics')||jsonb_build_object(
  'received_deposits_kobo',(select coalesce(sum(collected_kobo),0) from public.payment_attempts),
  'successful_refunds_kobo',(select coalesce(sum(refunded_kobo),0) from public.payment_attempts)));
end; $$;
