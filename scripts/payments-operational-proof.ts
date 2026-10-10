import {fixtureCheckout} from '../tests/database/reservation-fixtures';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure } from './lib/database';
import { verifiedStripeSandbox } from './lib/stripe-sandbox';
import { paymentHandler } from '../supabase/functions/palmsteeze-payments/index';
import { initialBookingDate,intervalFromSelection } from '../src/lib/domain';

async function main() {
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const api=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const endpoint=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`;
 const headers={Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'};
 const evidence:Record<string,unknown>={checkedAt:new Date().toISOString()};let userID='';let bookingID='';let sessionID='';
 try {
  await inspectDatabase(db);
  const job=(await db.query("select jobid,active,schedule,command from cron.job where jobname='palmsteeze-payment-recovery'")).rows[0];
  assert.ok(job);assert.equal(job.active,true);assert.equal(job.schedule,'* * * * *');assert.equal(job.command,'select private.invoke_payment_recovery()');
  const started=new Date();
  const email=`m2-schedule-${randomUUID()}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(created.data.user);userID=created.data.user.id;
  const signed=await api.auth.signInWithPassword({email,password});assert.ok(signed.data.session);assert.equal((await api.auth.getUser()).data.user?.id,userID);
  const resource=(await db.query("select id from public.resources where code='OPEN-13'")).rows[0].id;
  const interval=intervalFromSelection(initialBookingDate(new Date(Date.now()+18*86400000)),12,1);
  const quote=(await api.rpc('quote_resource',{p_resource:resource,p_start:interval.starts_at,p_end:interval.ends_at})).data;
  const expected=Object.fromEntries(['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'].map(k=>[k,quote[k]]));
  const begun=await fixtureCheckout(api,{p_resource:resource,p_start:interval.starts_at,p_end:interval.ends_at,p_request:randomUUID(),p_expected:expected});
  assert.equal(begun.error,null);bookingID=begun.data.booking.id;
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({bookingId:bookingID})})).status,200);
  sessionID=(await db.query('select session_id from public.payment_attempts where booking_id=$1',[bookingID])).rows[0].session_id;assert.ok(sessionID);
  // Expire only this unused sandbox Session to avoid a 35-minute test wait.
  // The application receives no cancellation request and must reconcile the
  // actual provider-expired/unpaid outcome through its operational schedule.
  await stripe.checkout.sessions.expire(sessionID);
  const outage:typeof fetch=async(input,init)=>{if(String(input).startsWith('https://api.stripe.com/')) throw new Error('Controlled provider outage before scheduled retry');return fetch(input,init);};
  const handler=paymentHandler({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey:process.env.SUPABASE_SECRET_KEY!,stripeKey:process.env.STRIPE_SECRET_KEY!,workerToken:process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN!,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET!,origin:'http://localhost:3000'},outage);
  const failure=await handler(new Request(endpoint,{method:'POST',headers,body:JSON.stringify({bookingId:bookingID})}));assert.equal(failure.status,503);
  assert.equal((await db.query('select active from public.allocations where booking_id=$1',[bookingID])).rows[0].active,true);
  const status=()=>db.query('select b.state,a.active,p.state as payment from public.bookings b join public.allocations a on a.booking_id=b.id join public.payment_attempts p on p.booking_id=b.id where b.id=$1',[bookingID]);
  let recovered=false;
  for(let i=0;i<90;i++) {
   const row=(await status()).rows[0];if(row.payment==='expired') {assert.deepEqual(row,{state:'expired',active:false,payment:'expired'});recovered=true;break;}
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  assert.equal(recovered,true,'Real operational schedule must complete without manual recovery.');
  const session=await stripe.checkout.sessions.retrieve(sessionID);assert.equal(session.status,'expired');assert.equal(session.payment_status,'unpaid');
  const ticks=(await db.query("select count(*)::int as n from cron.job_run_details where jobid=$1 and start_time>$2 and status='succeeded'",[job.jobid,started])).rows[0].n;assert.ok(ticks>=1);
  const unauthorized:Record<string,string>[]=[{},{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!},{Authorization:'Bearer invalid'}];
  for(const h of unauthorized) assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...h},body:'{}'})).status,401);
  evidence.operationalSchedule='PASSED';evidence.actualMinuteTicks=ticks;evidence.retryAfterControlledOutage='PASSED';evidence.actualStripeUnpaidExpiration='PASSED';evidence.unauthorizedRecovery='PASSED';evidence.scheduleRetained='* * * * *; at most two leased jobs per call';
  evidence.faultInjection='Provider outage deliberately injected locally; unused fixture Session explicitly expired through Stripe instead of waiting 35 minutes. Actual scheduled deployed Edge retry retrieves real expired/unpaid Stripe outcome.';
  console.log('PASSED: actual operational minute schedule retried a controlled outage, verified real unpaid Stripe expiration and released only its fixture. Unauthorized recovery rejected; documented operational schedule retained.');
 } finally {
  if(sessionID) {const session=await stripe.checkout.sessions.retrieve(sessionID);assert.notEqual(session.payment_status,'paid');if(session.status==='open') await stripe.checkout.sessions.expire(sessionID);}
  if(userID) {
   await db.query('begin');
   await db.query('delete from public.admin_audit where target_id in(select id from public.bookings where owner_id=$1)',[userID]);
   await db.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=$1)',[userID]);
   await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=$1)',[userID]);
   await db.query('delete from private.payment_jobs where attempt_id in(select id from public.payment_attempts where owner_id=$1)',[userID]);
   await db.query('delete from public.payment_attempts where owner_id=$1',[userID]);
   await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=$1)',[userID]);
   await db.query('delete from public.bookings where owner_id=$1',[userID]);await db.query('commit');
   assert.equal((await admin.auth.admin.deleteUser(userID)).error,null);
  }
  await db.end();mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m2-operational-recovery.json',JSON.stringify(evidence,null,2)+'\n');
 }
}
main().catch(safeFailure);
