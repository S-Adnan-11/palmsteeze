import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { verifyProject,connectDatabase,safeFailure } from './lib/database';
import { management } from './lib/management';

async function main() {
  await verifyProject();const client=await connectDatabase();
  try {
    const functions=await (await management('functions')).json() as {slug:string}[];
    const secrets=await (await management('secrets')).json() as {name:string}[];
    assert.equal(functions.some(f=>f.slug==='palmsteeze-recovery-proof'),false);
    assert.equal(secrets.some(s=>s.name==='PALMSTEEZE_RECOVERY_PROOF_TOKEN'),false);
    assert.equal(functions.some(f=>f.slug==='palmsteeze-payments'),true);
    for(const name of ['PALMSTEEZE_STRIPE_KEY','PALMSTEEZE_STRIPE_WEBHOOK_SECRET','PALMSTEEZE_PAYMENT_WORKER_TOKEN','PALMSTEEZE_APP_ORIGIN']) assert.equal(secrets.some(s=>s.name===name),true);
    const baseline=JSON.parse(readFileSync('docs/evidence/m2b-inspection.json','utf8')) as {checkedAt:string;legacyBookings:{total:number}};
    await client.query('begin read only');
    const {rows}=await client.query(`select
      (select count(*)::int from cron.job where active and (jobname like 'palmsteeze-platform-proof-%' or jobname like 'palmsteeze-proof-%')) as active_proof_jobs,
      (select count(*)::int from private.recovery_probe_runs) as remaining_probe_runs,
      (select count(*)::int from private.recovery_probe_jobs) as remaining_probe_jobs,
      (select count(*)::int from vault.secrets where name like 'palmsteeze_probe_url_%' or name like 'palmsteeze_probe_token_%') as remaining_probe_vault_secrets,
      (select count(*)::int from public.bookings) as preserved_booking_records,
      (select count(*)::int from public.bookings where created_at<=$1::timestamptz) as preexisting_booking_records,
      (select count(*)::int from public.bookings where created_at<=$1::timestamptz and payment_kind='legacy' and deposit_percent=30) as original_legacy_30_percent_snapshots,
      (select count(*)::int from cron.job where active and jobname='palmsteeze-payment-recovery' and schedule='* * * * *' and command='select private.invoke_payment_recovery()') as operational_payment_schedules,
      (select count(*)::int from vault.secrets where name in ('palmsteeze_payment_worker_url','palmsteeze_payment_worker_token')) as operational_vault_entries,
      (select count(*)::int from auth.users where email like 'm2-%@palmsteeze.invalid') as remaining_m2_test_identities,
      (select deposit_percent from public.venue_settings limit 1) as working_deposit_percent,
      (select count(*)::int from public.resources) as resources,
      (select sum(seats)::int from public.resources) as seats,
      exists(select 1 from public.bookings b where exists(select 1 from auth.identities i where i.user_id=b.owner_id and i.provider='google')) as google_owned_booking_still_present`,[baseline.checkedAt]);
    const result=rows[0];assert.equal(result.active_proof_jobs,0);assert.equal(result.remaining_probe_runs,0);assert.equal(result.remaining_probe_jobs,0);
    assert.equal(result.remaining_probe_vault_secrets,0);
    assert.equal(result.preexisting_booking_records,baseline.legacyBookings.total);assert.equal(result.resources,27);assert.equal(result.seats,44);assert.equal(result.google_owned_booking_still_present,true);
    assert.equal(result.original_legacy_30_percent_snapshots,baseline.legacyBookings.total);assert.equal(result.operational_payment_schedules,1);assert.equal(result.operational_vault_entries,2);assert.equal(result.remaining_m2_test_identities,0);assert.equal(result.working_deposit_percent,40);
    await client.query('commit');mkdirSync('docs/evidence',{recursive:true});
    writeFileSync('docs/evidence/m2b-final-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),...result,
      proofEdgeFunctionRemoved:true,proofEdgeSecretRemoved:true,paymentWorkerAndPrivateSecretsPresent:true},null,2)+'\n');
    console.log('PASSED: zero active proof jobs, probe records or probe Vault secrets; proof Edge function/secret removed. Both original bookings and Google-owned history preserved; inventory remains 27 resources / 44 seats. Read-only audit, no identities or credentials logged.');
    console.log(JSON.stringify({privateConfiguration:['STRIPE_SECRET_KEY','STRIPE_ACCOUNT_ID','STRIPE_SANDBOX_EMAIL'].map(name=>({name,present:Boolean(process.env[name])}))}));
  } finally {await client.end();}
}
main().catch(safeFailure);
