-- Isolated feasibility fixtures; never mutates customer bookings or allocations.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table private.recovery_probe_runs (
  id uuid primary key,
  expires_at timestamptz not null,
  calls integer not null default 0,
  created_at timestamptz not null default now()
);
create table private.recovery_probe_jobs (
  run_id uuid not null references private.recovery_probe_runs(id) on delete cascade,
  job_index integer not null check (job_index between 1 and 4),
  attempts integer not null default 0,
  fail_first boolean not null default false,
  state text not null default 'pending' check (state in ('pending','complete')),
  next_attempt_at timestamptz not null default now(),
  primary key(run_id,job_index)
);
alter table private.recovery_probe_runs enable row level security;
alter table private.recovery_probe_jobs enable row level security;
revoke all on private.recovery_probe_runs,private.recovery_probe_jobs from public,anon,authenticated;

create function public.process_recovery_probe(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j private.recovery_probe_jobs; processed integer := 0; failed integer := 0; remaining integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='Privileged recovery required';
  end if;
  -- Serialize one run, bound both its lifetime and total invocations.
  update private.recovery_probe_runs set calls=calls+1
    where id=p_run and expires_at>now() and calls<8;
  if not found then raise exception using errcode='22023',message='Probe run unavailable'; end if;
  for j in select * from private.recovery_probe_jobs
      where run_id=p_run and state='pending' and next_attempt_at<=now()
      order by job_index for update skip locked limit 2 loop
    processed := processed+1;
    if j.fail_first and j.attempts=0 then
      update private.recovery_probe_jobs set attempts=attempts+1,next_attempt_at=now()+interval '10 seconds'
        where run_id=p_run and job_index=j.job_index;
      failed := failed+1;
    else
      update private.recovery_probe_jobs set attempts=attempts+1,state='complete'
        where run_id=p_run and job_index=j.job_index;
    end if;
  end loop;
  select count(*) into remaining from private.recovery_probe_jobs where run_id=p_run and state='pending';
  return jsonb_build_object('processed',processed,'controlled_failure',failed>0,'remaining',remaining);
end;
$$;
revoke all on function public.process_recovery_probe(uuid) from public,anon,authenticated;
grant execute on function public.process_recovery_probe(uuid) to service_role;

create function private.invoke_recovery_probe(p_run uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare url text; token text;
begin
  if not exists(select 1 from private.recovery_probe_runs where id=p_run and expires_at>now() and calls<8) then return null; end if;
  select decrypted_secret into strict url from vault.decrypted_secrets where name='palmsteeze_probe_url_'||p_run::text;
  select decrypted_secret into strict token from vault.decrypted_secrets where name='palmsteeze_probe_token_'||p_run::text;
  return net.http_post(url:=url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:=jsonb_build_object('run_id',p_run),timeout_milliseconds:=10000);
end;
$$;
revoke all on function private.invoke_recovery_probe(uuid) from public,anon,authenticated,service_role;
