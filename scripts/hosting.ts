import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import Stripe from 'stripe';
import { configuredAppOrigin } from '../src/lib/deployment';
import {sharedServiceOrigins,hostedOrigin} from '../supabase/functions/_shared/application-origins';
import { verifyProject,connectDatabase,ReadinessError,safeFailure } from './lib/database';
import { management,deployFunction } from './lib/management';

const slug = 'palmsteeze-payments';
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
async function main() {
  const operation = process.argv[2] || 'inspect';
  const originIndex = process.argv.indexOf('--origin');
  if (process.argv.length > 3 && (originIndex !== 3 || process.argv.length !== 5)) {
    throw new ReadinessError("Use an exact --origin argument; in PowerShell quote npm's '--' separator as shown in M5_DEPLOYMENT.md.");
  }
  const requestedOrigin = originIndex >= 0 ? process.argv[originIndex+1] : undefined;
  if (!['inspect','prepare-worker'].includes(operation)) throw new ReadinessError('Use hosting:inspect or hosting:prepare-worker -- --origin https://YOUR-STABLE-HOST.vercel.app.');
  if (requestedOrigin) configuredAppOrigin({APP_ORIGIN:requestedOrigin,VERCEL:'1'});
  if (operation === 'prepare-worker' && !requestedOrigin) throw new ReadinessError('An explicit canonical HTTPS --origin is required. Run only after the pre-publication decision.');
  await verifyProject();
  const state = JSON.parse(readFileSync('.tools/private/payment-platform.json','utf8')) as {
    endpointID:string;token:string;signingSecret:string;functionCreated:boolean;
  };
  assert.equal(state.functionCreated,true);
  assert.equal(process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN,state.token);
  assert.equal(process.env.STRIPE_WEBHOOK_SECRET,state.signingSecret);
  assert.match(process.env.STRIPE_SECRET_KEY || '',/^(?:sk_test_|rk_test_|rkcs_test_)/);
  assert.equal(process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED,'true');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!,{maxNetworkRetries:1,timeout:15000});
  const account = await stripe.accounts.retrieveCurrent();
  assert.equal(account.id,process.env.STRIPE_ACCOUNT_ID);
  const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${slug}`;
  const [webhook,functions,secrets,auth] = await Promise.all([
    stripe.webhookEndpoints.retrieve(state.endpointID),
    management('functions').then(r => r.json()) as Promise<{slug:string;status:string;verify_jwt:boolean}[]>,
    management('secrets').then(r => r.json()) as Promise<{name:string;value:string}[]>,
    management('config/auth').then(r => r.json()) as Promise<{site_url:string;uri_allow_list:string;external_google_enabled:boolean;external_google_client_id:string}>,
  ]);
  assert.equal(webhook.livemode,false);assert.equal(webhook.status,'enabled');assert.equal(webhook.url,`${endpoint}/webhook`);
  for (const type of ['checkout.session.completed','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','refund.failed','charge.refunded']) assert.ok(webhook.enabled_events.includes(type));
  const worker = functions.find(f => f.slug === slug);
  assert.ok(worker);assert.equal(worker.status,'ACTIVE');assert.equal(worker.verify_jwt,false);
  for (const [name,value] of [['PALMSTEEZE_PAYMENT_WORKER_TOKEN',state.token],['PALMSTEEZE_STRIPE_KEY',process.env.STRIPE_SECRET_KEY!],['PALMSTEEZE_STRIPE_WEBHOOK_SECRET',state.signingSecret]]) {
    assert.equal(secrets.find(s => s.name === name)?.value,digest(value));
  }
  assert.equal(auth.external_google_enabled,true);assert.ok(auth.external_google_client_id);
  const originHash = secrets.find(s => s.name === 'PALMSTEEZE_APP_ORIGIN')?.value;
  assert.ok(originHash);
  const db = await connectDatabase();
  let audit:Record<string,number>;
  let recoveryHTTP: {status_code:number;timed_out:boolean;created:Date};
  const emptyProbeId = randomUUID();
  try {
    await db.query('begin read only');
    assert.equal((await db.query('select count(*)::int as n from public.bookings where id=$1',[emptyProbeId])).rows[0].n,0);
    const baseline = JSON.parse(readFileSync('docs/evidence/m2b-inspection.json','utf8'));
    audit = (await db.query(`select
      (select count(*)::int from public.bookings where created_at <= $1::timestamptz and payment_kind='legacy' and deposit_percent=30) as original_30_percent_snapshots,
      (select count(*)::int from public.payment_attempts a join public.bookings b on b.id=a.booking_id where b.created_at <= $1::timestamptz) as legacy_payment_attempts,
      (select deposit_percent from public.venue_settings) as new_deposit_percent,
      (select count(*)::int from public.resources) as resources,(select sum(seats)::int from public.resources) as seats,
      (select count(*)::int from auth.users where email like '%@palmsteeze.invalid') as remaining_test_identities,
      (select count(*)::int from public.payment_attempts where session_id is null and state in ('creating','open','review_required')) as uncertain_session_creations,
      (select count(*)::int from cron.job where active and jobname='palmsteeze-payment-recovery' and schedule='* * * * *' and command='select private.invoke_payment_recovery()') as correct_minute_schedule,
      (select count(*)::int from cron.job where active and jobname like 'palmsteeze-%') as all_palmsteeze_schedules,
      (select count(*)::int from vault.secrets where name in ('palmsteeze_payment_worker_url','palmsteeze_payment_worker_token')) as vault_entries`,[baseline.checkedAt])).rows[0];
    assert.equal(audit.original_30_percent_snapshots,baseline.legacyBookings.total);assert.equal(audit.legacy_payment_attempts,0);
    assert.equal(audit.new_deposit_percent,40);assert.equal(audit.resources,27);assert.equal(audit.seats,44);
    // Earlier paid synthetic proof may be deliberately retained. Report it;
    // never delete older records to satisfy a zero-fixture assumption.
    assert.equal(audit.correct_minute_schedule,1);assert.equal(audit.all_palmsteeze_schedules,1);assert.equal(audit.vault_entries,2);
    const vault = (await db.query("select name,decrypted_secret from vault.decrypted_secrets where name in ('palmsteeze_payment_worker_url','palmsteeze_payment_worker_token')")).rows;
    assert.equal(vault.find(s => s.name === 'palmsteeze_payment_worker_url')?.decrypted_secret,`${endpoint}/recover`);
    assert.equal(vault.find(s => s.name === 'palmsteeze_payment_worker_token')?.decrypted_secret,state.token);
    const recent = (await db.query("select status from cron.job_run_details where jobid=(select jobid from cron.job where jobname='palmsteeze-payment-recovery') order by start_time desc limit 1")).rows[0];
    assert.equal(recent?.status,'succeeded');
    recoveryHTTP = (await db.query("select status_code,timed_out,created from net._http_response where content like '{\"processed\":%' order by created desc limit 1")).rows[0];
    assert.ok(recoveryHTTP);assert.equal(recoveryHTTP.status_code,200);assert.equal(recoveryHTTP.timed_out,false);
    assert.ok(Date.now()-new Date(recoveryHTTP.created).getTime()<180000,'Recent recovery-shaped HTTP response required; cron dispatch alone is insufficient.');
    await db.query('commit');
  } catch (error) { await db.query('rollback');throw error; } finally { await db.end(); }
  const [unsigned,unprivileged] = await Promise.all([
    fetch(`${endpoint}/webhook`,{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)}),
    fetch(`${endpoint}/recover`,{method:'POST',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!},body:'{}',signal:AbortSignal.timeout(15000)}),
  ]);
  assert.equal(unsigned.status,400);assert.equal(unprivileged.status,401);
  const callbacks = (auth.uri_allow_list || '').split(',').map(s => s.trim());
  const report = {checkedAt:new Date().toISOString(),status:'PASSED',operation,...audit!,tls:'certificate verified',
    selectedPersistentSandbox:true,signedWebhookSubscriptions:true,workerSecretsAndVaultMatch:true,
    latestCronDispatchSucceeded:true,recentRecoveryHTTP200:true,recoveryHTTPObservedAt:recoveryHTTP!.created,
    unsignedWebhookRejected:true,publishableOnlyRecoveryRejected:true,
    localWorkerOrigin:originHash === digest('http://localhost:3000'),
    requestedHostedOriginMatches:requestedOrigin ? originHash === digest(requestedOrigin) : null,
    hostedAuthSiteURLMatches:requestedOrigin ? auth.site_url === requestedOrigin : null,
    hostedExactCallbackAllowed:requestedOrigin ? callbacks.includes(`${requestedOrigin}/auth/callback`) : null,
    localCallbackPreserved:callbacks.includes('http://localhost:3000/auth/callback'),
    billingAndMonthlyUsage:'Owner dashboard confirmation required; existing Free attestation preserved.',
    syntheticIdentityScope:'Count includes preserved historical proof; compare release before/after fingerprints. No automatic deletion.',
    postCutoverEmptyRecovery:'NOT RUN',publicationPerformed:false,recordsMutated:false};
  if (operation === 'prepare-worker') {
    if(requestedOrigin!==hostedOrigin) throw new ReadinessError('NOT RUN: only the reviewed hosted hostname is authorized.');
    if (!report.hostedExactCallbackAllowed || !report.hostedAuthSiteURLMatches) throw new ReadinessError('NOT RUN: configure exact hosted Supabase Site URL/callback first.');
    const originDB=await connectDatabase();
    try {
      const origins=(await originDB.query('select allowed_origins from private.reservation_security_config where singleton')).rows[0]?.allowed_origins;
      assert.deepEqual([...origins].sort(),[...sharedServiceOrigins].sort());
    } finally {await originDB.end();}
    // Preserve every secret, including the historical return fallback. New
    // attempts persist their own independently validated initiating origin.
    await deployFunction(slug,readFileSync(`supabase/functions/${slug}/index.ts`,'utf8'));
    const after = await (await management('secrets')).json() as {name:string;value:string}[];
    const sorted=(values:typeof after)=>values.map(({name,value})=>({name,value})).sort((a,b)=>a.name.localeCompare(b.name));
    assert.deepEqual(sorted(after),sorted(secrets));
    const empty = await fetch(`${endpoint}/recover`,{method:'POST',headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'application/json'},
      body:JSON.stringify({bookingId:emptyProbeId}),signal:AbortSignal.timeout(15000)});
    assert.equal(empty.status,200);assert.deepEqual(await empty.json(),{processed:0,completed:0,deferred:0});
    const unsignedAfter = await fetch(`${endpoint}/webhook`,{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)});
    assert.equal(unsignedAfter.status,400);
    report.postCutoverEmptyRecovery = 'PASSED - unknown booking, zero claimed jobs; signature rejection retained.';
    report.postCutoverEmptyRecovery += ' All secrets/historical fallback unchanged; persisted hosted origins supported.';
  }
  mkdirSync('docs/evidence/m5',{recursive:true});
  const file = `docs/evidence/m5/infrastructure-${Date.now()}.json`;
  writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
main().catch(error=>{
  // Print code location only, never AssertionError actual/expected or payloads.
  if(error instanceof assert.AssertionError) console.error(error.stack?.split('\n').find(line=>line.includes('scripts')&&line.includes('hosting.ts'))?.trim()||'Infrastructure assertion failed.');
  safeFailure(error);
});
