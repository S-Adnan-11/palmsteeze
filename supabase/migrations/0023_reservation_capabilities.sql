-- Authorised M4 boundary: keep authoritative implementations and historical
-- rows intact; require a server-signed, operation-bound, one-use capability.
create table private.reservation_security_config (
 singleton boolean primary key default true check(singleton),
 signing_key text not null check(signing_key ~ '^[a-f0-9]{64}$'),
 app_origin text not null
);
create table private.reservation_authorizations (
 nonce uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null,
 consumed_at timestamptz not null default clock_timestamp()
);
alter table private.reservation_security_config enable row level security;
alter table private.reservation_authorizations enable row level security;
revoke all on private.reservation_security_config,private.reservation_authorizations from public,anon,authenticated,service_role;

create function private.consume_reservation_authorization(
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
  or payload->>'origin' is distinct from config.app_origin or (payload->>'sub')::uuid is distinct from auth.uid()
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
revoke all on function private.consume_reservation_authorization(text,text,uuid,timestamptz,timestamptz,uuid,jsonb,bigint) from public,anon,authenticated,service_role;

create function public.create_verified_hold(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_capability text)
returns public.bookings language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_reservation_authorization(p_capability,'hold',p_resource,p_start,p_end,p_request,null,null);
 return public.create_hold(p_resource,p_start,p_end,p_request);
end; $$;
create function public.begin_verified_checkout(p_resource uuid,p_start timestamptz,p_end timestamptz,p_request uuid,p_expected jsonb,p_amount bigint,p_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_reservation_authorization(p_capability,'checkout',p_resource,p_start,p_end,p_request,p_expected,p_amount);
 return public.begin_checkout(p_resource,p_start,p_end,p_request,p_expected,p_amount);
end; $$;
revoke all on function public.create_verified_hold(uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.begin_verified_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.create_verified_hold(uuid,timestamptz,timestamptz,uuid,text) to authenticated;
grant execute on function public.begin_verified_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint,text) to authenticated;
revoke all on function public.create_hold(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.begin_checkout(uuid,timestamptz,timestamptz,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.begin_checkout(uuid,timestamptz,timestamptz,uuid,jsonb,bigint) from public,anon,authenticated,service_role;
