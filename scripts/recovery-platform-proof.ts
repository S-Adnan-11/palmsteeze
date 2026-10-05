import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure } from './lib/database';

async function main() {
  await verifyProject();const client=await connectDatabase();const run=randomUUID();let job:number|undefined;let request:number|undefined;
  const evidence:Record<string,unknown>={checkedAt:new Date().toISOString()};
  try {
    await inspectDatabase(client);
    await client.query("insert into private.recovery_probe_runs(id,expires_at) values($1,now()+interval '2 minutes')",[run]);
    const command=`update private.recovery_probe_runs set calls=calls+1 where id='${run}'::uuid and expires_at>now() and calls<2`;
    job=Number((await client.query('select cron.schedule($1,$2,$3) as job',[`palmsteeze-platform-proof-${run}`,'10 seconds',command])).rows[0].job);
    for (let attempt=0;attempt<15;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,2000));
      const calls=Number((await client.query('select calls from private.recovery_probe_runs where id=$1',[run])).rows[0].calls);
      if (calls===2) break;
    }
    assert.equal(Number((await client.query('select calls from private.recovery_probe_runs where id=$1',[run])).rows[0].calls),2);
    const history=await client.query("select count(*)::int as count from cron.job_run_details where jobid=$1 and status='succeeded'",[job]);
    assert.equal(history.rows[0].count>=2,true);evidence.realCronExecution='PASSED';
    request=Number((await client.query('select net.http_get(url:=$1,headers:=$2::jsonb,timeout_milliseconds:=10000) as id',[
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,JSON.stringify({apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}),
    ])).rows[0].id);
    let status:number|undefined;
    for (let attempt=0;attempt<15;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,1000));
      const response=await client.query('select status_code from net._http_response where id=$1',[request]);
      if (response.rowCount) {status=response.rows[0].status_code;break;}
    }
    assert.equal(status,200);evidence.pgNetSelectedProjectHttps='PASSED';
    console.log('PASSED: live pg_cron executed two bounded SQL probe iterations; pg_net reached the selected Supabase HTTPS API with HTTP 200. No customer data changed.');
    console.log('NOT RUN: protected scheduled Edge processing/retry remains a separate gate requiring Edge Function secret/deploy permissions.');
  } finally {
    try {
      if (job!==undefined) {await client.query('select cron.unschedule($1::bigint)',[job]);await client.query('delete from cron.job_run_details where jobid=$1',[job]);evidence.temporaryJobDisabled='PASSED';}
      if (request!==undefined) await client.query('delete from net._http_response where id=$1',[request]);
      await client.query('delete from private.recovery_probe_runs where id=$1',[run]);
    } finally {await client.end();}
    mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m2b-platform-recovery.json',JSON.stringify(evidence,null,2)+'\n');
  }
}
main().catch(safeFailure);
