-- Newly authorized initial-payment choices. Existing snapshots and attempt
-- amounts remain intact; the original five-argument RPC means minimum deposit.
create or replace function public.begin_checkout(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_expected jsonb,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; a public.payment_attempts; expected jsonb; chosen bigint;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':hold',0));
 perform pg_advisory_xact_lock(hashtextextended(p_resource::text||':allocation',0));
 select * into b from public.bookings where owner_id=auth.uid() and request_id=p_request;
 if found then
  if b.payment_kind<>'checkout' or b.resource_id is distinct from p_resource
    or b.starts_at is distinct from p_start or b.ends_at is distinct from p_end then
   raise exception using errcode='22023',message='Request cannot be reused';
  end if;
  select * into strict a from public.payment_attempts where booking_id=b.id;
  if a.amount_kobo is distinct from coalesce(p_amount,b.deposit_kobo) then raise exception using errcode='22023',message='Request amount cannot be changed';end if;
  return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(a));
 end if;
 -- create_hold owns the authoritative validation, quote snapshot and exclusion
 -- insertion. This wrapper commits the payment attempt/job in the SAME transaction.
 perform public.create_hold(p_resource,p_start,p_end,p_request);
 select * into strict b from public.bookings where owner_id=auth.uid() and request_id=p_request;
 expected=jsonb_build_object('hourly_kobo',b.hourly_kobo,'total_kobo',b.total_kobo,
  'deposit_percent',b.deposit_percent,'deposit_kobo',b.deposit_kobo,'balance_kobo',b.balance_kobo);
 if p_expected is distinct from expected then
  raise exception using errcode='P0001',message='Quote changed; review again';
 end if;
 chosen=coalesce(p_amount,b.deposit_kobo);
 if chosen not between b.deposit_kobo and b.total_kobo then raise exception using errcode='22023',message='Payment must be between the minimum deposit and booking total';end if;
 update public.bookings set payment_kind='checkout' where id=b.id returning * into b;
 insert into public.payment_attempts(booking_id,owner_id,amount_kobo,currency,requested_expires_at)
  values(b.id,b.owner_id,chosen,lower(b.currency),now()+make_interval(mins=>(b.policy_snapshot->>'checkout_minutes')::integer)) returning * into a;
 insert into private.payment_jobs(attempt_id) values(a.id);
 return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(a));
end;
$$;

revoke all on function public.begin_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint) from public,anon;
grant execute on function public.begin_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint) to authenticated;
create or replace function public.begin_checkout(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_expected jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select public.begin_checkout(p_resource,p_start,p_end,p_request,p_expected,null);
$$;
alter table public.payment_attempts add column collected_kobo bigint not null default 0,
 add column refunded_kobo bigint not null default 0,
 add constraint collected_bounds check(collected_kobo between 0 and amount_kobo and refunded_kobo between 0 and collected_kobo);
-- Prior application references were persisted only after verified collection.
update public.payment_attempts set collected_kobo=amount_kobo,refunded_kobo=case when refund_state='succeeded' then amount_kobo else 0 end where payment_intent_id is not null;
alter table public.refund_operations add column prepared_at timestamptz;
update public.refund_operations set prepared_at=updated_at where refund_id is not null;
create table public.payment_refund_receipts (
 refund_id text primary key,attempt_id uuid not null references public.payment_attempts(id) on delete cascade,
 amount_kobo bigint not null check(amount_kobo>0),state text not null check(state in ('pending','requires_action','succeeded','failed','canceled')),
 verified_at timestamptz not null default now()
);
alter table public.payment_refund_receipts enable row level security;
revoke all on public.payment_refund_receipts from public,anon,authenticated;
grant select on public.payment_refund_receipts to authenticated;
create policy own_refund_receipts on public.payment_refund_receipts for select to authenticated using((select public.is_admin()) or exists(select 1 from public.payment_attempts a where a.id=attempt_id and a.owner_id=(select auth.uid())));
-- Trusted worker passes a complete bounded provider list for this verified PI.
create function public.record_refund_snapshot(p_attempt uuid,p_lease uuid,p_collected bigint,p_refunds jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;r jsonb;total bigint:=0;reserved bigint:=0;op public.refund_operations;found_id text;found_amount bigint;last_id text;last_amount bigint;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required';end if;
 perform 1 from private.payment_jobs where attempt_id=p_attempt and lease_token=p_lease for update;
 if not found then raise exception using errcode='22023',message='Stale lease';end if;
 select * into strict a from public.payment_attempts where id=p_attempt for update;
 if a.payment_intent_id is null or p_collected is distinct from a.amount_kobo or jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds)>100 then raise exception using errcode='22023',message='Verified collected payment and bounded refund list required';end if;
 if (select count(*) from jsonb_array_elements(p_refunds))<>(select count(distinct value->>'id') from jsonb_array_elements(p_refunds)) then raise exception using errcode='22023',message='Duplicate refund references';end if;
 for r in select value from jsonb_array_elements(p_refunds) loop
  if r->>'id' !~ '^re_[A-Za-z0-9]+$' or (r->>'amount')::bigint not between 1 and p_collected or r->>'currency' is distinct from a.currency or r->>'payment_intent' is distinct from a.payment_intent_id or r->>'status' not in ('pending','requires_action','succeeded','failed','canceled') or r->>'status' is null then raise exception using errcode='22023',message='Refund snapshot mismatch';end if;
  insert into public.payment_refund_receipts(refund_id,attempt_id,amount_kobo,state) values(r->>'id',a.id,(r->>'amount')::bigint,r->>'status')
   on conflict(refund_id) do update set state=excluded.state,verified_at=now() where payment_refund_receipts.attempt_id=excluded.attempt_id and payment_refund_receipts.amount_kobo=excluded.amount_kobo;
  if not found then raise exception using errcode='22023',message='Refund reference mismatch';end if;
  if r->>'status'='succeeded' then total=total+(r->>'amount')::bigint;last_id=r->>'id';last_amount=(r->>'amount')::bigint;end if;
  if r->>'status' in ('pending','requires_action') then reserved=reserved+(r->>'amount')::bigint;end if;
  if r->>'id'=a.refund_id or (a.refund_id is null and r->'metadata'->>'palmsteeze_payment_id'=a.id::text and coalesce(r->'metadata'->>'palmsteeze_refund_generation','0')=a.refund_generation::text) then
   if found_id is not null then raise exception using errcode='22023',message='Ambiguous refund operation';end if;
   found_id=r->>'id';found_amount=(r->>'amount')::bigint;
  end if;
 end loop;
 if total+reserved>p_collected then raise exception using errcode='22023',message='Refunds exceed collected payment';end if;
 -- Complete lists must not silently omit an earlier verified refund.
 if exists(select 1 from public.payment_refund_receipts receipt where receipt.attempt_id=a.id and not exists(select 1 from jsonb_array_elements(p_refunds) item where item->>'id'=receipt.refund_id)) then raise exception using errcode='22023',message='Incomplete refund snapshot';end if;
 update public.payment_attempts set collected_kobo=p_collected,refunded_kobo=total where id=a.id returning * into a;
 select * into op from public.refund_operations where attempt_id=a.id and generation=a.refund_generation for update;
 if not found then raise exception using errcode='22023',message='Refund operation required';end if;
 if a.refund_id is not null and found_id is null then raise exception using errcode='22023',message='Known refund missing';end if;
 if found_id is null and total=p_collected then found_id=last_id;found_amount=last_amount;end if;
 if found_id is not null then
  if op.prepared_at is not null and op.amount_kobo<>found_amount then raise exception using errcode='22023',message='Prepared refund amount mismatch';end if;
  update public.payment_attempts set refund_id=found_id where id=a.id returning * into a;
  update public.refund_operations set refund_id=found_id,amount_kobo=found_amount,prepared_at=coalesce(prepared_at,now()) where id=op.id returning * into op;
 elsif reserved=0 and total<p_collected then
  if op.prepared_at is not null and op.amount_kobo>p_collected-total then raise exception using errcode='22023',message='Uncertain prepared refund exceeds remaining payment';end if;
  update public.refund_operations set amount_kobo=case when prepared_at is null then p_collected-total else amount_kobo end,prepared_at=coalesce(prepared_at,now()) where id=op.id returning * into op;
 end if;
 return to_jsonb(a)||jsonb_build_object('refund_amount_kobo',op.amount_kobo,'pending_refund_kobo',reserved);
end; $$;
revoke all on function public.record_refund_snapshot(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.record_refund_snapshot(uuid,uuid,bigint,jsonb) to service_role;
-- A genuinely succeeded card refund can later fail. Preserve each operation
-- and reverify known refunds instead of treating success as irreversible.
create or replace function public.prepare_refund_operation(p_attempt uuid,p_lease uuid,p_failed jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 perform 1 from private.payment_jobs where attempt_id=p_attempt and lease_token=p_lease for update;
 if not found then raise exception using errcode='22023',message='Stale lease'; end if;
 select * into strict a from public.payment_attempts where id=p_attempt for update;
 if a.state not in ('refund_required','refunded') then raise exception using errcode='22023',message='Refund work required'; end if;
 if p_failed is not null then
  if not a.refund_retry_requested or a.refund_id is null or p_failed->>'id' is distinct from a.refund_id
   or p_failed->>'status' not in ('failed','canceled') or (p_failed->>'amount')::bigint is distinct from (select amount_kobo from public.refund_operations where attempt_id=a.id and generation=a.refund_generation)
   or p_failed->>'currency' is distinct from a.currency or p_failed->>'payment_intent' is distinct from a.payment_intent_id
   or p_failed->>'environment' is distinct from 'sandbox' then raise exception using errcode='22023',message='Verified failed prior refund required'; end if;
  update public.refund_operations set state='failed',refund_id=a.refund_id,updated_at=now() where attempt_id=a.id and generation=a.refund_generation;
  update public.payment_attempts set refund_generation=refund_generation+1,refund_id=null,refund_retry_requested=false,refund_state='required',refund_started_at=now(),updated_at=now() where id=a.id returning * into a;
  perform private.audit_admin('failed_refund_retry_prepared',a.booking_id,'Backend verified prior failed refund',jsonb_build_object('generation',a.refund_generation));
 end if;
 insert into public.refund_operations(attempt_id,generation,amount_kobo,currency,refund_id)
 values(a.id,a.refund_generation,a.amount_kobo,a.currency,a.refund_id) on conflict(attempt_id,generation) do nothing;
 return to_jsonb(a);
end; $$;
-- A request to retry a failed local refund must not remain latent after the
-- provider instead verifies a pending/successful result. Consume that request;
-- a later genuine failure requires another deliberate administrator action.
create or replace function public.finish_payment_work(p_attempt uuid,p_lease uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.payment_attempts; current_payment public.payment_attempts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 select * into strict prior from public.payment_attempts where id=p_attempt;
 if p_result->>'result'='paid' then
  update public.payment_attempts set collected_kobo=amount_kobo where id=p_attempt;
 end if;
 if p_result->>'result' in ('refund_pending','refund_failed','refunded') and p_result ? 'refunded_amount' then
  if (p_result->>'collected_amount')::bigint is distinct from prior.amount_kobo or (p_result->>'refunded_amount')::bigint not between 0 and prior.amount_kobo
   or (p_result->>'refund_amount')::bigint is distinct from (select amount_kobo from public.refund_operations where attempt_id=p_attempt and generation=prior.refund_generation)
   or (p_result->>'result'='refunded' and (p_result->>'refunded_amount')::bigint<>prior.amount_kobo) then raise exception using errcode='22023',message='Verified refund total mismatch';end if;
  update public.payment_attempts set collected_kobo=(p_result->>'collected_amount')::bigint,refunded_kobo=(p_result->>'refunded_amount')::bigint where id=p_attempt;
 end if;
 perform private.finish_payment_work_m2(p_attempt,p_lease,p_result);
 if p_result->>'result'='refunded' and not(p_result ? 'refunded_amount') then
  update public.payment_attempts set collected_kobo=amount_kobo,refunded_kobo=amount_kobo where id=p_attempt;
 end if;
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
