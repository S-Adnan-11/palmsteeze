import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {verifyProject,connectDatabase,safeFailure} from './lib/database';
import {management,deployFunction} from './lib/management';
import {allowedAppOrigins,configuredAppOrigin,developmentOrigins} from '../src/lib/deployment';

const evidence=process.env.PALMSTEEZE_ORIGIN_EVIDENCE||'docs/evidence/m4-tunnel-20261016';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function main() {
  const operation=process.argv[2];
  assert.ok(['before','after','deploy-worker'].includes(operation));
  await verifyProject();
  assert.equal(configuredAppOrigin(process.env),developmentOrigins[0]);
  assert.notEqual(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE,'true');
  const db=await connectDatabase();
  let records:Record<string,unknown>;
  try {
    await db.query('begin read only');
    records={};
    for(const table of ['bookings','allocations','payment_attempts','cancellation_requests','admin_audit','refund_operations','payment_refund_receipts']) {
      // Exclude the new nullable column so the same historical-row hash works
      // before and after 0025, without exporting business data or identities.
      records[table]=(await db.query(`select count(*)::int count,md5(coalesce(string_agg(row::text,'' order by row::text),'')) hash from (select to_jsonb(t)-'return_origin' row from public.${table} t) rows`)).rows[0];
    }
    records.infrastructure=(await db.query(`select
      (select count(*)::int from cron.job where active and jobname='palmsteeze-payment-recovery' and schedule='* * * * *' and command='select private.invoke_payment_recovery()') schedule,
      (select count(*)::int from vault.secrets where name in ('palmsteeze_payment_worker_url','palmsteeze_payment_worker_token')) vault_entries`)).rows[0];
    await db.query('commit');
  } finally {await db.end();}
  mkdirSync(evidence,{recursive:true});
  if(operation==='deploy-worker') {
    const state=JSON.parse(readFileSync('.tools/private/payment-platform.json','utf8'));
    assert.equal(state.functionCreated,true);
    assert.equal(state.token,process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN);
    const secrets=await (await management('secrets')).json() as {name:string;value:string}[];
    for(const [name,value] of [['PALMSTEEZE_APP_ORIGIN',developmentOrigins[0]],['PALMSTEEZE_PAYMENT_WORKER_TOKEN',state.token],['PALMSTEEZE_STRIPE_WEBHOOK_SECRET',state.signingSecret],['PALMSTEEZE_STRIPE_KEY',process.env.STRIPE_SECRET_KEY!]]) {
      assert.equal(secrets.find(s=>s.name===name)?.value,digest(value));
    }
    assert.match(process.env.STRIPE_SECRET_KEY||'',/^(?:sk_test_|rk_test_|rkcs_test_)/);
    const functions=await (await management('functions')).json() as {slug:string;verify_jwt:boolean;status:string;version:number}[];
    const previous=functions.find(f=>f.slug==='palmsteeze-payments');
    assert.equal(previous?.status,'ACTIVE');assert.equal(previous?.verify_jwt,false);
    await deployFunction('palmsteeze-payments',readFileSync('supabase/functions/palmsteeze-payments/index.ts','utf8'));
    const afterSecrets=await (await management('secrets')).json() as {name:string;value:string}[];
    const sort=(items:typeof secrets)=>items.map(s=>({name:s.name,value:s.value})).sort((a,b)=>a.name.localeCompare(b.name));
    assert.deepEqual(sort(afterSecrets),sort(secrets));
    const after=await (await management('functions')).json() as typeof functions;
    const worker=after.find(f=>f.slug==='palmsteeze-payments');assert.equal(worker?.status,'ACTIVE');assert.equal(worker?.verify_jwt,false);
    const endpoint=process.env.NEXT_PUBLIC_SUPABASE_URL+'/functions/v1/palmsteeze-payments';
    const unauthorized=await fetch(endpoint+'/recover',{method:'POST',body:'{}'});
    const unsigned=await fetch(endpoint+'/webhook',{method:'POST',body:'{}'});
    assert.equal(unauthorized.status,401);assert.equal(unsigned.status,400);
    writeFileSync(evidence+'/worker.json',JSON.stringify({at:new Date().toISOString(),previousVersion:previous?.version,version:worker?.version,allSecretsUnchanged:true,unauthorizedRecovery:401,unsignedWebhook:400,infrastructure:records.infrastructure},null,2),{flag:'wx'});
    console.log('PASSED: existing development worker updated; all secrets, canonical origin, webhook address, Vault and cron preserved.');
    return;
  }
  const auth=await (await management('config/auth')).json();
  const callbacks=String(auth.uri_allow_list||'').split(',').map(value=>value.trim());
  const report={at:new Date().toISOString(),records,origins:allowedAppOrigins(process.env),googleEnabled:auth.external_google_enabled===true,
    siteURL:auth.site_url,callbacks:developmentOrigins.map(origin=>({url:origin+'/auth/callback',allowed:callbacks.includes(origin+'/auth/callback')})),dashboardChanges:false};
  if(operation==='after') assert.deepEqual(records,JSON.parse(readFileSync(evidence+'/before.json','utf8')).records);
  writeFileSync(`${evidence}/${operation}.json`,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
}
main().catch(safeFailure);
