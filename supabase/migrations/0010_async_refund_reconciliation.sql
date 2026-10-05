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
   or p_failed->>'status' not in ('failed','canceled') or (p_failed->>'amount')::bigint is distinct from a.amount_kobo
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
create or replace function public.receive_payment_event(p_event text,p_attempt uuid,p_type text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare existing private.payment_events;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Backend required'; end if;
 if p_event !~ '^evt_[A-Za-z0-9]+$' or p_type not in ('checkout.session.completed','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','refund.failed','charge.refunded') then
  raise exception using errcode='22023',message='Invalid event'; end if;
 -- Signed Stripe events for deleted run-owned fixtures need no recovery work.
 if not exists(select 1 from public.payment_attempts where id=p_attempt) then return; end if;
 insert into private.payment_jobs(attempt_id) values(p_attempt) on conflict(attempt_id) do update set next_attempt_at=now();
 insert into private.payment_events(event_id,attempt_id,event_type,payload) values(p_event,p_attempt,p_type,p_payload) on conflict(event_id) do nothing;
 select * into strict existing from private.payment_events where event_id=p_event;
 if existing.attempt_id<>p_attempt or existing.event_type<>p_type then raise exception using errcode='22023',message='Event identity mismatch'; end if;
end; $$;
