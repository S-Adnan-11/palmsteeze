import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure,ReadinessError } from './lib/database';
import { management,deployFunction } from './lib/management';

const slug='palmsteeze-recovery-proof';
const name='PALMSTEEZE_RECOVERY_PROOF_TOKEN';
const file='.tools/private/recovery-probe.json';
type State={run:string;token:string;functionCreated:boolean;secretCreated:boolean};
function save(state:State) {mkdirSync('.tools/private',{recursive:true});writeFileSync(file,JSON.stringify(state),{mode:0o600});}
async function main() {
  await verifyProject();
  if (process.argv[2]==='prepare') {
    const functions=await (await management('functions')).json();
    if (functions.some((f:{slug:string})=>f.slug===slug)) throw new ReadinessError('NOT RUN: proof function already exists; inspect run-owned state before updating.');
    const secrets=await (await management('secrets')).json();
    if (secrets.some((s:{name:string})=>s.name===name)) throw new ReadinessError('NOT RUN: proof secret already exists; no existing secret overwritten.');
    const state:State={run:randomUUID(),token:randomBytes(32).toString('base64url'),functionCreated:false,secretCreated:false};save(state);
    try {
      await management('secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{name,value:state.token}])});
      state.secretCreated=true;save(state);
      await deployFunction(slug,readFileSync(`supabase/functions/${slug}/index.ts`,'utf8'));
      state.functionCreated=true;save(state);
      console.log('PASSED: isolated protected development Edge Function deployed; opaque proof token captured privately. No customer data or Next.js publication.');
    } catch(error) {
      if (state.secretCreated) {await management('secrets',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify([name])});state.secretCreated=false;save(state);}
      throw error;
    }
    return;
  }
  if (process.argv[2]!=='prove' || !existsSync(file)) throw new ReadinessError('NOT RUN: prepare the isolated Edge Function before proving recovery.');
  const state:State=JSON.parse(readFileSync(file,'utf8'));
  if (!state.functionCreated || !state.secretCreated) throw new ReadinessError('NOT RUN: Edge Function preparation incomplete.');
  const client=await connectDatabase();let job:number|undefined;
  const endpoint=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${slug}`;
  const evidence:Record<string,unknown>={runStartedAt:new Date().toISOString()};
  try {
    await inspectDatabase(client);
    const before=(await client.query("select md5(coalesce(string_agg(to_jsonb(b)::text,'' order by id),'')) as hash from public.bookings b")).rows[0].hash;
    // Real SQL role checks; no owner-only permission claim.
    for (const role of ['anon','authenticated']) {
      await client.query('begin');await client.query(`set local role ${role}`);
      assert.equal((await client.query('select current_user as role')).rows[0].role,role);
      try {await client.query('select public.process_recovery_probe($1)',[state.run]);assert.fail('Unprivileged role executed recovery');}
      catch(error) {assert.equal((error as {code?:string}).code,'42501');}
      await client.query('rollback');
    }
    evidence.sqlUnprivilegedRecovery='PASSED';
    await client.query('begin');
    await client.query("insert into private.recovery_probe_runs(id,expires_at) values($1,now()+interval '7 minutes')",[state.run]);
    await client.query('insert into private.recovery_probe_jobs(run_id,job_index,fail_first) select $1,i,i=1 from generate_series(1,4) i',[state.run]);
    await client.query('select vault.create_secret($1,$2,$3)',[endpoint,`palmsteeze_probe_url_${state.run}`,'Run-owned recovery feasibility URL']);
    await client.query('select vault.create_secret($1,$2,$3)',[state.token,`palmsteeze_probe_token_${state.run}`,'Run-owned opaque recovery token']);
    await client.query('commit');
    // Publishable API keys cannot authorize privileged work, even with JWT verification disabled.
    const unauthorizedHeaders:Record<string,string>[]=[{},{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!},
      {apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,Authorization:'Bearer invalid-recovery-token'}];
    for (const headers of unauthorizedHeaders) {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({run_id:state.run}),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,401);
    }
    assert.equal(Number((await client.query('select calls from private.recovery_probe_runs where id=$1',[state.run])).rows[0].calls),0);
    evidence.httpUnauthorizedAndPublishableOnly='PASSED';
    job=Number((await client.query('select cron.schedule($1,$2,$3) as job',[`palmsteeze-proof-${state.run}`,'* * * * *',`select private.invoke_recovery_probe('${state.run}'::uuid)`])).rows[0].job);
    console.log('RUNNING: minute schedule enabled for run-owned probe only; hard limit two jobs per call, eight calls and seven-minute run lifetime. No customer bookings touched.');
    let controlledFailure=false;let bounded=false;let complete=false;
    for (let elapsed=0;elapsed<240;elapsed+=10) {
      await new Promise(resolve=>setTimeout(resolve,10000));
      const rows=(await client.query('select job_index,attempts,state from private.recovery_probe_jobs where run_id=$1 order by job_index',[state.run])).rows;
      const calls=Number((await client.query('select calls from private.recovery_probe_runs where id=$1',[state.run])).rows[0].calls);
      if (calls===1) {
        bounded=rows.filter(r=>Number(r.attempts)>0).length===2;
        controlledFailure=rows[0].state==='pending' && Number(rows[0].attempts)===1;
      }
      if (elapsed%30===0) console.log(`RUNNING: scheduled calls ${calls}; completed probe jobs ${rows.filter(r=>r.state==='complete').length}/4.`);
      if (rows.every(r=>r.state==='complete')) {
        assert.equal(Number(rows[0].attempts),2);assert.equal(calls>=3 && calls<=8,true);complete=true;break;
      }
    }
    assert.equal(bounded,true);assert.equal(controlledFailure,true);assert.equal(complete,true);
    const runs=(await client.query('select status from cron.job_run_details where jobid=$1',[job])).rows;
    assert.equal(runs.some(r=>r.status==='succeeded'),true);
    const after=(await client.query("select md5(coalesce(string_agg(to_jsonb(b)::text,'' order by id),'')) as hash from public.bookings b")).rows[0].hash;
    assert.equal(before===after,true);
    Object.assign(evidence,{scheduledExecution:'PASSED',boundedProcessing:'PASSED',controlledFailureRetry:'PASSED',existingBookingsUnchanged:'PASSED',controlledFault:'first probe job intentionally deferred; not a Stripe outage'});
    console.log('PASSED: real scheduled Edge execution, bounded work, durable retry after controlled failure, and unchanged customer bookings.');
  } finally {
    await client.query('rollback');
    if (job!==undefined) {await client.query('select cron.unschedule($1::bigint)',[job]);evidence.temporaryScheduleDisabled='PASSED';}
    await client.query("delete from vault.secrets where name=any($1::text[])",[[`palmsteeze_probe_url_${state.run}`,`palmsteeze_probe_token_${state.run}`]]);
    await client.query('delete from private.recovery_probe_runs where id=$1',[state.run]);
    await client.end();
    if (state.functionCreated) {await management(`functions/${slug}`,{method:'DELETE'});state.functionCreated=false;}
    if (state.secretCreated) {await management('secrets',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify([name])});state.secretCreated=false;}
    save(state);mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m2b-recovery.json',JSON.stringify(evidence,null,2)+'\n');
    console.log('PASSED: temporary proof job disabled; run-owned Vault/Edge secrets, function and probe records removed. Extensions and versioned schema retained; no operational payment schedule enabled.');
  }
}
main().catch(safeFailure);
