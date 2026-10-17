-- Development preview only. Exact origins are provisioned by migration tooling.
-- Preserve historical attempts, provider sessions, guarded creators and JWT ownership.
alter table private.reservation_security_config add column allowed_origins text[];
update private.reservation_security_config set allowed_origins=array[app_origin];
alter table private.reservation_security_config alter column allowed_origins set not null;
alter table private.reservation_security_config add constraint reservation_origins_include_canonical
 check(cardinality(allowed_origins)>0 and app_origin=any(allowed_origins) and array_position(allowed_origins,null) is null);
alter table public.payment_attempts add column return_origin text;

create or replace function private.consume_reservation_authorization(
 p_capability text,p_operation text,p_resource uuid,p_start timestamptz,p_end timestamptz,
 p_request uuid,p_expected jsonb,p_amount bigint
) returns void language plpgsql set search_path='' as $$
declare payload jsonb; encoded text; supplied text; expected text;
 config private.reservation_security_config; issued bigint; expiry bigint; seconds bigint;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then
  raise exception using errcode='42501',message='Verified customer required';
 end if;
 if p_capability is null or length(p_capability)>4096 or p_capability !~ '^[A-Za-z0-9_-]+\.[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='Reservation authorization required';
 end if;
 select * into strict config from private.reservation_security_config where singleton;
 encoded=split_part(p_capability,'.',1);supplied=split_part(p_capability,'.',2);
 expected=encode(extensions.hmac(convert_to('palmsteeze-reservation-v1.'||encoded,'UTF8'),convert_to(config.signing_key,'UTF8'),'sha256'),'hex');
 -- Hash fixed-length signatures before comparison so no supplied prefix is
 -- compared directly against the secret-dependent signature.
 if extensions.digest(supplied,'sha256')<>extensions.digest(expected,'sha256') then
  raise exception using errcode='42501',message='Invalid reservation authorization';
 end if;
 payload=convert_from(decode(translate(encoded,'-_','+/')||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb;
 issued=(payload->>'iat')::bigint;expiry=(payload->>'exp')::bigint;
 seconds=floor(extract(epoch from clock_timestamp()))::bigint;
 if payload->>'v' is distinct from '1' or payload->>'purpose' is distinct from 'reservation'
  or payload->>'origin' is null or not (payload->>'origin'=any(config.allowed_origins)) or (payload->>'sub')::uuid is distinct from auth.uid()
  or payload->>'operation' is distinct from p_operation or (payload->>'resource')::uuid is distinct from p_resource
  or (payload->>'start')::timestamptz is distinct from p_start or (payload->>'end')::timestamptz is distinct from p_end
  or (payload->>'request')::uuid is distinct from p_request
  or payload->'amount' is distinct from coalesce(to_jsonb(p_amount),'null'::jsonb)
  or payload->'quote' is distinct from coalesce(p_expected,'null'::jsonb)
  or issued is null or expiry is null or expiry-issued<>60 or issued>seconds+30 or expiry<=seconds then
  raise exception using errcode='42501',message='Reservation authorization mismatch or expiry';
 end if;
 -- Prune only this new ephemeral authorization table, never business records.
 delete from private.reservation_authorizations where expires_at<clock_timestamp();
 insert into private.reservation_authorizations(nonce,user_id,expires_at)
 values((payload->>'nonce')::uuid,auth.uid(),to_timestamp(expiry)) on conflict do nothing;
 if not found then raise exception using errcode='42501',message='Reservation authorization already consumed';end if;
exception when others then
 raise exception using errcode='42501',message='Reservation authorization failed';
end;
$$;

-- Persist the SIGNED initiating origin in the transaction that creates the job.
-- The user lock matches begin_checkout; fresh retry grants retain the first origin.
create or replace function public.begin_verified_checkout(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_expected jsonb,p_amount bigint,p_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; existing boolean; initiating_origin text;
begin
 perform private.consume_reservation_authorization(p_capability,'checkout',p_resource,p_start,p_end,p_request,p_expected,p_amount);
 initiating_origin=convert_from(decode(translate(split_part(p_capability,'.',1),'-_','+/')||repeat('=',(4-length(split_part(p_capability,'.',1))%4)%4),'base64'),'UTF8')::jsonb->>'origin';
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':hold',0));
 select exists(select 1 from public.bookings where owner_id=auth.uid() and request_id=p_request) into existing;
 result=public.begin_checkout(p_resource,p_start,p_end,p_request,p_expected,p_amount);
 if not existing then
  update public.payment_attempts set return_origin=initiating_origin
   where id=(result->'payment'->>'id')::uuid and owner_id=auth.uid() and return_origin is null;
  result=jsonb_set(result,'{payment,return_origin}',to_jsonb(initiating_origin));
 end if;
 return result;
end; $$;
revoke all on function public.begin_verified_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_verified_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint,text) to authenticated;
