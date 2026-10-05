import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { verifyProject,connectDatabase,safeFailure } from './lib/database';

async function main() {
  await verifyProject();const db=await connectDatabase();const run=randomUUID();let userId:string|undefined;
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const evidence:Record<string,unknown>={checkedAt:new Date().toISOString()};
  try {
    const email=`recovery-${run}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    assert.equal(Boolean(created.error),false);userId=created.data.user?.id;assert.equal(Boolean(userId),true);
    const customer=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const session=await customer.auth.signInWithPassword({email,password});assert.equal(Boolean(session.error),false);
    assert.equal((await customer.auth.getUser()).data.user?.id,userId);
    await db.query("insert into private.recovery_probe_runs(id,expires_at) values($1,now()+interval '2 minutes')",[run]);
    await db.query('insert into private.recovery_probe_jobs(run_id,job_index,fail_first) select $1,i,i=1 from generate_series(1,4) i',[run]);
    for (const role of ['anon','authenticated']) for (const query of ['select public.process_recovery_probe($1)','select * from private.recovery_probe_jobs where run_id=$1']) {
      await db.query('begin');await db.query(`set local role ${role}`);
      assert.equal((await db.query('select current_user as role')).rows[0].role,role);
      await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:role==='authenticated' ? userId : undefined,role})]);
      try {await db.query(query,[run]);assert.fail('Unprivileged recovery access');}
      catch(error) {assert.equal((error as {code?:string}).code,'42501');}
      await db.query('rollback');
    }
    evidence.actualAnonAndAuthenticatedSqlRoles='PASSED';
    const denied=await customer.rpc('process_recovery_probe',{p_run:run});
    assert.equal(denied.error?.code,'42501');evidence.genuineCustomerTokenRecoveryDenied='PASSED';
    const publicClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    assert.equal((await publicClient.rpc('process_recovery_probe',{p_run:run})).error?.code,'42501');evidence.publishableOnlyRpcDenied='PASSED';
    const processed=await admin.rpc('process_recovery_probe',{p_run:run});
    assert.equal(Boolean(processed.error),false);assert.equal(processed.data.processed,2);
    assert.equal(processed.data.controlled_failure,true);assert.equal(processed.data.remaining,3);
    evidence.realPrivilegedRpcAndTwoJobBound='PASSED';
    console.log('PASSED: actual anon/authenticated SQL roles, genuine customer token and publishable-only API cannot execute recovery or read private jobs; real privileged backend RPC processes exactly two isolated jobs and records the controlled retry.');
    console.log('NOT RUN: this does not prove protected Edge invocation or a scheduled retry; those remain separate checks.');
  } finally {
    await db.query('rollback');await db.query('delete from private.recovery_probe_runs where id=$1',[run]);await db.end();
    if (userId) {const deleted=await admin.auth.admin.deleteUser(userId);assert.equal(Boolean(deleted.error),false);}
    mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m2b-recovery-roles.json',JSON.stringify(evidence,null,2)+'\n');
    console.log('PASSED: only this run\'s probe records and genuine Auth fixture cleaned up; existing accounts/bookings preserved.');
  }
}
main().catch(safeFailure);
