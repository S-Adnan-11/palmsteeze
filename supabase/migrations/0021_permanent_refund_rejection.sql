-- Owner-approved M3 exception: permanent provider refusal preserves an unpaid
-- reimbursement obligation. There is deliberately no settlement/unblock API.
alter table public.payment_attempts add column refund_blocked boolean not null default false,
 add column refund_failure_reason text check(refund_failure_reason is null or refund_failure_reason='provider_refused_refund'),
 add column refund_blocked_at timestamptz;
alter table public.payment_attempts add constraint permanent_refund_rejection_consistent
 check(not refund_blocked or (state='review_required' and refund_state='failed' and not refund_retry_requested and refund_blocked_at is not null and refund_failure_reason is not null));
alter table public.refund_operations drop constraint refund_operations_state_check;
alter table public.refund_operations add constraint refund_operations_state_check check(state in ('requested','pending','succeeded','failed','rejected'));
alter table public.refund_operations add column failure_reason text check(failure_reason is null or failure_reason='provider_refused_refund');

create function public.stop_rejected_refund(p_attempt uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts; op public.refund_operations;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required';end if;
 perform 1 from private.payment_jobs where attempt_id=p_attempt and lease_token=p_lease for update;
 if not found then raise exception using errcode='22023',message='Stale lease';end if;
 select * into strict a from public.payment_attempts where id=p_attempt for update;
 select * into strict op from public.refund_operations where attempt_id=a.id and generation=a.refund_generation for update;
 if a.state<>'refund_required' or a.refund_id is not null or op.refund_id is not null or op.prepared_at is null or a.payment_intent_id is null
  then raise exception using errcode='22023',message='Prepared rejected refund required';end if;
 update public.payment_attempts set state='review_required',refund_state='failed',refund_retry_requested=false,
  refund_blocked=true,refund_failure_reason='provider_refused_refund',refund_blocked_at=now(),updated_at=now() where id=a.id;
 update public.refund_operations set state='rejected',failure_reason='provider_refused_refund',updated_at=now() where id=op.id;
 update private.payment_events set state='processed',processed_at=coalesce(processed_at,now()) where attempt_id=a.id and state='pending';
 delete from private.payment_jobs where attempt_id=a.id;
 perform private.audit_admin('refund_permanently_rejected',a.booking_id,'Stripe permanently refused refund creation; administrator assistance required',
  jsonb_build_object('generation',a.refund_generation,'outstanding_reimbursement_kobo',a.collected_kobo-a.refunded_kobo,'provider_http_status',400,'provider_error_type','invalid_request_error'));
end; $$;
revoke all on function public.stop_rejected_refund(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stop_rejected_refund(uuid,uuid) to service_role;

alter function public.admin_queue_recovery(uuid,text) set schema private;
alter function private.admin_queue_recovery(uuid,text) rename to admin_queue_recovery_unblocked;
revoke all on function private.admin_queue_recovery_unblocked(uuid,text) from public,anon,authenticated,service_role;
create function public.admin_queue_recovery(p_booking uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 perform private.require_admin(p_reason);
 perform 1 from private.payment_jobs j join public.payment_attempts p on p.id=j.attempt_id where p.booking_id=p_booking for update of j;
 select * into a from public.payment_attempts where booking_id=p_booking for update;
 if not found then raise exception using errcode='22023',message='Payment attempt unavailable';end if;
 if a.refund_blocked then return p_booking;end if;
 return private.admin_queue_recovery_unblocked(p_booking,p_reason);
end; $$;
revoke all on function public.admin_queue_recovery(uuid,text) from public,anon;
grant execute on function public.admin_queue_recovery(uuid,text) to authenticated;

alter function public.receive_payment_event(text,uuid,text,jsonb) set schema private;
alter function private.receive_payment_event(text,uuid,text,jsonb) rename to receive_payment_event_unblocked;
revoke all on function private.receive_payment_event_unblocked(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.receive_payment_event(p_event text,p_attempt uuid,p_type text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.receive_payment_event_unblocked(p_event,p_attempt,p_type,p_payload);
 if exists(select 1 from public.payment_attempts where id=p_attempt and refund_blocked) then
  update private.payment_events set state='processed',processed_at=coalesce(processed_at,now()) where event_id=p_event;
  delete from private.payment_jobs where attempt_id=p_attempt;
 end if;
end; $$;
revoke all on function public.receive_payment_event(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.receive_payment_event(text,uuid,text,jsonb) to service_role;

alter function public.claim_payment_work(uuid,integer) set schema private;
alter function private.claim_payment_work(uuid,integer) rename to claim_payment_work_unblocked;
revoke all on function private.claim_payment_work_unblocked(uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_payment_work(p_booking uuid default null,p_limit integer default 2) returns jsonb
language plpgsql security definer set search_path='' as $$
declare work jsonb; item jsonb; result jsonb:='[]';
begin
 work=private.claim_payment_work_unblocked(p_booking,p_limit);
 for item in select value from jsonb_array_elements(work) loop
  if (item->'attempt'->>'refund_blocked')::boolean then
   delete from private.payment_jobs where attempt_id=(item->'attempt'->>'id')::uuid;
  else result=result||jsonb_build_array(item);end if;
 end loop;
 return result;
end; $$;
revoke all on function public.claim_payment_work(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_payment_work(uuid,integer) to service_role;

-- Detail includes the COMPLETE per-booking audit/refund history, independent
-- of the overview's latest-100 list. Identity enrichment remains admin-only.
create or replace function public.admin_booking_snapshot(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=public.admin_snapshot();
 return private.enrich_admin_snapshot(result||jsonb_build_object(
 'bookings',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.bookings b where id=p_booking),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p)-'checkout_url'),'[]') from public.payment_attempts p where booking_id=p_booking),
 'cancellations',(select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc),'[]') from public.cancellation_requests c where booking_id=p_booking),
 'refunds',(select coalesce(jsonb_agg(to_jsonb(r) order by generation),'[]') from public.refund_operations r join public.payment_attempts p on p.id=r.attempt_id where p.booking_id=p_booking),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by created_at),'[]') from public.admin_audit a where target_id=p_booking)));
end; $$;
