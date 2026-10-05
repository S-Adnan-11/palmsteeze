-- Insert-only defaults: reruns never overwrite existing inventory, rates, or operator configuration.
insert into public.venue_settings(id) values(true) on conflict(id) do nothing;
insert into public.resources(code,name,kind,seats,description)
select 'OPEN-' || lpad(n::text,2,'0'),'Open desk ' || lpad(n::text,2,'0'),'open_desk',1,
  'A bright shared workspace with room to think, reliable Wi-Fi and power.'
from generate_series(1,16) n on conflict(code) do nothing;
insert into public.resources(code,name,kind,seats,description)
select 'QUIET-' || lpad(n::text,2,'0'),'Quiet desk ' || lpad(n::text,2,'0'),'quiet_desk',1,
  'A calmer corner for deep work, with a dedicated desk and fewer distractions.'
from generate_series(1,8) n on conflict(code) do nothing;
insert into public.resources(code,name,kind,seats,description) values
  ('COVE','Cove','room',4,'A private room for small teams and good conversations.'),
  ('GROVE','Grove','room',6,'Bring the team together around one table.'),
  ('CANOPY','Canopy','room',10,'A generous whole room for workshops and bigger ideas.')
on conflict(code) do nothing;
insert into public.resource_rates(resource_id,effective_at,hourly_kobo)
select id,'2026-01-01T00:00:00Z'::timestamptz,
  case when kind = 'open_desk' then 200000 when kind = 'quiet_desk' then 250000
    when code = 'COVE' then 800000 when code = 'GROVE' then 1200000 when code = 'CANOPY' then 2000000 end
from public.resources
where code ~ '^(OPEN-(0[1-9]|1[0-6])|QUIET-0[1-8]|COVE|GROVE|CANOPY)$'
and not exists(select 1 from public.resource_rates rr where rr.resource_id = resources.id)
on conflict(resource_id,effective_at) do nothing;
do $$
begin
  if (select count(*) from public.resources) <> 27 or (select sum(seats) from public.resources) <> 44
      or (select count(*) from public.resources where kind in ('open_desk','quiet_desk')) <> 24
      or (select count(*) from public.resources where kind = 'room') <> 3 then
    raise exception 'Inventory differs from the dedicated M1 seed; review before proceeding';
  end if;
end;
$$;
