-- Resolve qualified record/alias ambiguity and allow read-only verification of known refunds.
create or replace function public.admin_decide_cancellation(p_request uuid,p_approve boolean,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests; b public.bookings; a public.payment_attempts; desired text;
begin
 perform private.require_admin(p_reason);
 if p_approve is null then raise exception using errcode='22023',message='Decision required'; end if;
 select * into c from public.cancellation_requests where id=p_request;
 if not found then raise exception using errcode='22023',message='Cancellation request unavailable'; end if;
 -- Job -> payment -> booking -> cancellation follows the worker lock order.
 perform 1 from private.payment_jobs j join public.payment_attempts payment on payment.id=j.attempt_id where payment.booking_id=c.booking_id for update of j;
 select * into strict a from public.payment_attempts where booking_id=c.booking_id for update;
 select * into strict b from public.bookings where id=c.booking_id for update;
 select * into strict c from public.cancellation_requests where id=p_request for update;
 desired=case when p_approve then 'approved' else 'rejected' end;
 if c.state=desired then return b.id; end if;
 if c.state<>'pending' or b.state<>'confirmed' or a.state<>'paid' or a.payment_intent_id is null then
  raise exception using errcode='22023',message='Pending request and verified paid booking required';
 end if;
 update public.cancellation_requests set state=desired,decided_at=now(),decided_by=auth.uid(),decision_reason=btrim(p_reason) where id=c.id;
 if p_approve then
  update public.bookings set state='cancelled' where id=b.id;
  update public.allocations set active=false where booking_id=b.id;
  update public.payment_attempts set state='refund_required',refund_state='required',refund_started_at=coalesce(refund_started_at,now()),updated_at=now() where id=a.id;
  insert into public.refund_operations(attempt_id,generation,amount_kobo,currency) values(a.id,a.refund_generation,a.amount_kobo,a.currency) on conflict(attempt_id,generation) do nothing;
  insert into private.payment_jobs(attempt_id) values(a.id) on conflict(attempt_id) do update set next_attempt_at=now();
 end if;
 perform private.audit_admin('cancellation_'||desired,b.id,btrim(p_reason),jsonb_build_object('request_id',c.id,'deposit_kobo',a.amount_kobo));
 return b.id;
end; $$;
create or replace function public.admin_queue_recovery(p_booking uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.payment_attempts;
begin
 perform private.require_admin(p_reason);
 perform 1 from private.payment_jobs j join public.payment_attempts p on p.id=j.attempt_id where p.booking_id=p_booking for update of j;
 select * into a from public.payment_attempts where booking_id=p_booking for update;
 if not found then raise exception using errcode='22023',message='Payment attempt unavailable'; end if;
 if a.state in ('paid','expired','creation_failed') then return p_booking; end if;
 if a.state='review_required' then
  if a.refund_id is not null and a.refund_state='failed' then
   update public.payment_attempts set state='refund_required',refund_retry_requested=true,updated_at=now() where id=a.id;
  elsif a.session_id is not null then
   update public.payment_attempts set state=case when a.refund_state in ('required','pending') then 'refund_required' else 'open' end,updated_at=now() where id=a.id;
  else raise exception using errcode='22023',message='Unknown provider reference requires investigation; creating a new payment is unsafe'; end if;
 end if;
 insert into private.payment_jobs(attempt_id) values(a.id) on conflict(attempt_id) do update set next_attempt_at=now();
 perform private.audit_admin('recovery_requested',p_booking,btrim(p_reason),jsonb_build_object('payment_state',a.state,'refund_state',a.refund_state));
 return p_booking;
end; $$;
create or replace function public.admin_create_closure(p_resource uuid,p_start timestamptz,p_end timestamptz,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.allocations; affected jsonb; closure uuid;
begin
 perform private.require_admin(p_reason);
 if p_request is null or p_start is null or p_end is null or p_end<=p_start or not isfinite(p_start) or not isfinite(p_end) then raise exception using errcode='22023',message='Valid request and finite interval required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_resource::text||':allocation',0));
 select * into existing from public.allocations where admin_request_id=p_request;
 if found then
  if existing.resource_id is distinct from p_resource or existing.period<>tstzrange(p_start,p_end,'[)') or existing.reason<>btrim(p_reason) then raise exception using errcode='22023',message='Request cannot be reused'; end if;
  return existing.id;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('bookingId',booking_id,'allocationId',id,'kind',kind)), '[]') into affected from public.allocations where resource_id=p_resource and active and period&&tstzrange(p_start,p_end,'[)');
 if jsonb_array_length(affected)>0 then raise exception using errcode='23P01',message='Closure conflicts with active allocations',detail=affected::text; end if;
 closure=public.create_closure(p_resource,p_start,p_end,p_reason);
 update public.allocations set admin_request_id=p_request where id=closure;
 perform private.audit_admin('closure_created',closure,btrim(p_reason),jsonb_build_object('resource_id',p_resource,'starts_at',p_start,'ends_at',p_end));
 return closure;
end; $$;
