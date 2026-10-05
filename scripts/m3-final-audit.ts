import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {verifyProject,connectDatabase,safeFailure,ReadinessError} from './lib/database';
import {verifiedStripeSandbox} from './lib/stripe-sandbox';
import {management} from './lib/management';
async function main(){
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();
 try {
  const email=process.env.PALMSTEEZE_OWNER_ADMIN_EMAIL;const id=process.env.PALMSTEEZE_OWNER_ADMIN_USER_ID;
  if(Boolean(email)===Boolean(id)) throw new ReadinessError('NOT RUN: exactly one private intended administrator identifier required.');
  const baseline=JSON.parse(readFileSync('docs/evidence/m2b-inspection.json','utf8')) as {checkedAt:string;legacyBookings:{total:number}};
  const state=JSON.parse(readFileSync('.tools/private/payment-platform.json','utf8')) as {endpointID:string};
  const endpoint=await stripe.webhookEndpoints.retrieve(state.endpointID);assert.equal(endpoint.livemode,false);assert.equal(endpoint.status,'enabled');assert.equal(endpoint.url,`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/webhook`);assert.ok(endpoint.enabled_events.includes('refund.failed'));
  const functions=await(await management('functions')).json() as {slug:string}[];
  assert.ok(functions.some(f=>f.slug==='palmsteeze-payments'));assert.equal(functions.some(f=>f.slug==='palmsteeze-recovery-proof'),false);
  await db.query('begin read only');
  const result=(await db.query(`select
   (select count(*)::int from public.bookings where created_at<=$1::timestamptz) as original_booking_count,
   (select count(*)::int from public.bookings where created_at<=$1::timestamptz and payment_kind='legacy' and deposit_percent=30) as original_unpaid_30_percent_snapshots,
   (select count(*)::int from public.payment_attempts a join public.bookings b on b.id=a.booking_id where b.created_at<=$1::timestamptz) as original_bookings_payment_attempts,
   (select count(*)::int from public.resources) as resources,(select sum(seats)::int from public.resources) as seats,
   (select deposit_percent from public.venue_settings) as new_deposit_percent,
   (select count(*)::int from auth.users where email like 'm3-%@palmsteeze.invalid' or email like 'm2-%@palmsteeze.invalid' or email like 'm2a-%@palmsteeze.invalid') as remaining_test_identities,
   (select count(*)::int from cron.job where active and jobname='palmsteeze-payment-recovery' and schedule='* * * * *' and command='select private.invoke_payment_recovery()') as operational_schedules,
   (select count(*)::int from cron.job where active and (jobname like 'palmsteeze-platform-proof-%' or jobname like 'palmsteeze-proof-%')) as active_proof_jobs,
   (select count(*)::int from vault.secrets where name in ('palmsteeze_payment_worker_url','palmsteeze_payment_worker_token')) as operational_vault_entries`,[baseline.checkedAt])).rows[0];
  const selected=(await db.query(`select u.id,r.role,exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google' and i.identity_data->>'email_verified'='true' and ($1::text is null or lower(i.identity_data->>'email')=lower($1))) as verified_google,
   exists(select 1 from public.admin_audit a where a.action='owner_admin_assigned' and a.target_id=u.id) as audited from auth.users u left join private.app_roles r on r.user_id=u.id
   where ($1::text is not null and lower(u.email)=lower($1)) or ($2::text is not null and u.id::text=$2)`,[email||null,id||null])).rows;
  assert.equal(selected.length,1);assert.equal(selected[0].role,'admin');assert.equal(selected[0].verified_google,true);assert.equal(selected[0].audited,true);
  assert.equal(result.original_booking_count,baseline.legacyBookings.total);assert.equal(result.original_unpaid_30_percent_snapshots,baseline.legacyBookings.total);assert.equal(result.original_bookings_payment_attempts,0);
  assert.equal(result.resources,27);assert.equal(result.seats,44);assert.equal(result.new_deposit_percent,40);assert.equal(result.remaining_test_identities,0);assert.equal(result.operational_schedules,1);assert.equal(result.active_proof_jobs,0);assert.equal(result.operational_vault_entries,2);
  await db.query('commit');mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m3-final-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),status:'PASSED',...result,selectedVerifiedGoogleAdministrator:true,assignmentAudited:true,sandboxWebhookEnabled:true,refundFailureEventsEnabled:true,proofEdgeFunctionAbsent:true,tls:'certificate verified'},null,2)+'\n');
  console.log('PASSED: read-only final audit verifies original unpaid 30% bookings, new 40% setting, explicit verified Google administrator, inventory, fixture cleanup, signed refund-failure subscription and the single protected operational schedule. Identities and credentials withheld.');
 }catch(error){await db.query('rollback');throw error;}finally{await db.end();}
}
main().catch(safeFailure);
