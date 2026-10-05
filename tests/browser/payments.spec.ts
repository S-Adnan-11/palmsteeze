import { test,expect,type BrowserContext,type Page } from '@playwright/test';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import type { Client } from 'pg';
import type Stripe from 'stripe';
import AxeBuilder from '@axe-core/playwright';
import { verifyProject,connectDatabase,inspectDatabase } from '../../scripts/lib/database';
import { verifiedStripeSandbox } from '../../scripts/lib/stripe-sandbox';
import { initialBookingDate,intervalFromSelection } from '../../src/lib/domain';
import { visitDestination } from '../../src/lib/auth/destinations';
import { paymentHandler } from '../../supabase/functions/palmsteeze-payments/index';
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
test.describe.configure({mode:'serial',timeout:240000});
const origin='http://localhost:3000';const headers={Origin:origin};
type User={id:string;email:string;password:string};
let db:Client;let stripe:Stripe;let admin:SupabaseClient;
const users:User[]=[];const bookings:string[]=[];const evidence:Record<string,unknown>={};let resources:Record<string,string>;
async function signIn(context:BrowserContext,user:User) {
 const jar=new Map<string,string>();const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
  cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))}});
 const signed=await client.auth.signInWithPassword({email:user.email,password:user.password});expect(Boolean(signed.data.session)).toBe(true);
 expect((await client.auth.getUser()).data.user?.id).toBe(user.id);
 await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
}
async function pay(page:Page) {
 await page.getByRole('link',{name:'Continue to secure Stripe sandbox checkout'}).click();
 await page.locator('#email').fill(`m2-${randomUUID()}@palmsteeze.invalid`);
 await page.locator('#cardNumber').fill('4242424242424242');await page.locator('#cardExpiry').fill('1234');await page.locator('#cardCvc').fill('123');
 if(await page.locator('#billingName').isVisible()) await page.locator('#billingName').fill('PalmSteeze sandbox fixture');
 if(await page.locator('#billingPostalCode').isVisible()) await page.locator('#billingPostalCode').fill('10001');
 await page.locator('button[type=submit]').click();await page.waitForURL(/http:\/\/localhost:3000\/booking\//,{timeout:90000});
}
test.beforeAll(async()=>{
 await verifyProject();stripe=await verifiedStripeSandbox();db=await connectDatabase();await inspectDatabase(db);
 admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 for(let i=0;i<2;i++) {
  const email=`m2-browser-${randomUUID()}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin'}});expect(Boolean(created.data.user)).toBe(true);
  users.push({id:created.data.user!.id,email,password});
 }
 mkdirSync('.tools/private',{recursive:true});writeFileSync('.tools/private/m2-browser-fixtures.json',JSON.stringify(users),{mode:0o600});
 resources=Object.fromEntries((await db.query("select code,id from public.resources where code in ('OPEN-15','OPEN-16')")).rows.map(r=>[r.code,r.id]));
});
test.afterAll(async()=>{
 if(!db) return;const ids=users.map(u=>u.id);
 const attempts=(await db.query('select id,session_id,booking_id from public.payment_attempts where owner_id=any($1::uuid[])',[ids])).rows;
 // Provider cleanup touches only this run's sessions and refunds actually received
 // sandbox funds before deleting fixture history. A failed refund retains fixtures.
 for(const attempt of attempts) if(attempt.session_id) {
  const session=await stripe.checkout.sessions.retrieve(attempt.session_id,{expand:['payment_intent']});
  if(session.status==='open'&&session.payment_status==='unpaid') await stripe.checkout.sessions.expire(session.id);
  if(session.payment_status==='paid') {
   const intent=session.payment_intent as Stripe.PaymentIntent;const refunds=await stripe.refunds.list({payment_intent:intent.id});
   const completed=refunds.data.filter(r=>r.status==='succeeded').reduce((sum,r)=>sum+r.amount,0);
   if(completed===0) {
    const refund=await stripe.refunds.create({payment_intent:intent.id,amount:intent.amount_received,metadata:{palmsteeze_payment_id:attempt.id,palmsteeze_environment:'development'}},{idempotencyKey:`palmsteeze-browser-cleanup-${attempt.id}`});
    expect(refund.status).toBe('succeeded');expect(refund.amount).toBe(intent.amount_received);
   } else expect(completed).toBe(intent.amount_received);
  }
 }
 // Let natural fixture events reach the receiver, then finish their durable work.
 await new Promise(r=>setTimeout(r,3000));
 for(const attempt of attempts) await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{
  method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:attempt.booking_id})});
 await db.query('begin');
 await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
 await db.query('delete from private.payment_jobs where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
 await db.query('delete from public.admin_audit where actor_id=any($1::uuid[]) or target_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);
 await db.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
  await db.query('delete from public.payment_attempts where owner_id=any($1::uuid[])',[ids]);
  await db.query('delete from public.cancellation_requests where owner_id=any($1::uuid[])',[ids]);
 await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);
 await db.query('delete from public.bookings where owner_id=any($1::uuid[])',[ids]);await db.query('commit');
 for(const user of users) expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull();
 await db.end();mkdirSync('docs/evidence',{recursive:true});writeFileSync(`docs/evidence/m2-browser-${test.info().project.name}.json`,JSON.stringify({checkedAt:new Date().toISOString(),...evidence,fixtureCleanup:'PASSED'},null,2)+'\n');
});
test('real authenticated review checkout confirmation history isolation and late-payment refund',async({page,context,browser},info)=>{
 await signIn(context,users[0]);const date=initialBookingDate(new Date(Date.now()+16*86400000));
 const selection={resource:resources['OPEN-16'],date,hour:11,duration:1};
 await page.goto(visitDestination(selection));await expect(page.getByLabel('Verified visit quote')).toContainText('₦800');
 const resultPromise=page.waitForResponse(r=>r.url().endsWith('/api/checkout')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Reserve with sandbox payment'}).click();const response=await resultPromise;expect([201,202]).toContain(response.status());
 const body=await response.json();const id=body.booking.id;bookings.push(id);
 await expect(page).toHaveURL(new RegExp(`/booking/${id}`));await expect(page.getByTestId('payment-state')).toContainText('open');
 const stored=(await db.query('select owner_id,deposit_kobo,deposit_percent from public.bookings where id=$1',[id])).rows[0];
 expect(stored.owner_id).toBe(users[0].id);expect(Number(stored.deposit_kobo)).toBe(80000);expect(stored.deposit_percent).toBe(40);
 const repeated=await context.request.post('/api/checkout',{headers,data:response.request().postDataJSON()});expect(repeated.status()).toBe(201);expect((await repeated.json()).booking.id).toBe(id);
 await page.goto(`/booking/${id}?checkout=returned`);await expect(page.getByTestId('booking-state')).toContainText('held');await expect(page.getByTestId('payment-state')).toContainText('open');
 const other=await browser.newContext({baseURL:origin});const anon=await browser.newContext({baseURL:origin});
 try {
  await signIn(other,users[1]);expect((await other.request.get(`/api/bookings/${id}`)).status()).toBe(404);
  expect((await other.request.delete(`/api/bookings/${id}/checkout`,{headers})).status()).toBe(403);
  expect((await other.request.post('/api/admin/recovery',{headers,data:{bookingId:id}})).status()).toBe(403);
  expect((await anon.request.get(`/api/bookings/${id}`)).status()).toBe(401);expect((await anon.request.post('/api/checkout',{headers,data:{}})).status()).toBe(401);
  expect((await context.request.get(`/api/bookings/${id}`,{headers:{Authorization:'Bearer invalid-session'}})).status()).toBe(401);
  expect((await context.request.post('/api/checkout',{headers,data:{...response.request().postDataJSON(),state:'paid'}})).status()).toBe(400);
  const privateResponse=await context.request.get(`/api/bookings/${id}`);expect(privateResponse.headers()['cache-control']).toContain('no-store');expect(privateResponse.headers().vary.toLowerCase()).toContain('authorization');
  await pay(page);
  await expect(page.getByTestId('booking-state')).toContainText('confirmed',{timeout:30000});
  await expect(page.getByTestId('payment-state')).toContainText('paid');
  const verification=await context.request.get(`/api/bookings/${id}`);expect(verification.status()).toBe(200);
  if((await verification.json()).payment.state!=='paid') {
   const row=(await db.query('select j.last_error,j.attempts,j.lease_until>now() as active_lease from private.payment_jobs j join public.payment_attempts p on p.id=j.attempt_id where p.booking_id=$1',[id])).rows[0];
   console.error(JSON.stringify({paymentRecoveryDiagnostic:row}));
   const diagnosticFetch:typeof fetch=async(input,init)=>{
    const r=await fetch(input,init);if(!r.ok) writeFileSync('.tools/private/payment-http-error.json',await r.clone().text(),{mode:0o600});return r;
   };
   const handler=paymentHandler({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey:process.env.SUPABASE_SECRET_KEY!,stripeKey:process.env.STRIPE_SECRET_KEY!,workerToken:process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN!,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET!,origin},diagnosticFetch);
   const r=await handler(new Request(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:id})}));
   console.error(JSON.stringify({localRecoveryDiagnostic:await r.json()}));
   throw new Error('Deployed application failed to verify paid checkout; private backend diagnostic saved.');
  }
  await page.reload();await expect(page.getByTestId('booking-state')).toContainText('confirmed');await expect(page.getByTestId('payment-state')).toContainText('paid');
  const attempt=(await db.query('select id,session_id,payment_intent_id from public.payment_attempts where booking_id=$1',[id])).rows[0];
  const session=await stripe.checkout.sessions.retrieve(attempt.session_id,{expand:['payment_intent']});expect(session.livemode).toBe(false);expect(session.payment_status).toBe('paid');expect(session.amount_total).toBe(80000);
  const intent=session.payment_intent as Stripe.PaymentIntent;expect(intent.status).toBe('succeeded');expect(intent.amount_received).toBe(80000);
  await expect.poll(async()=>(await db.query('select count(*)::int as n from private.payment_events where attempt_id=$1',[attempt.id])).rows[0].n,{timeout:30000}).toBeGreaterThan(0);
  // Controlled missed-receipt fault in this isolated fixture. Reconciliation
  // must retrieve the genuine paid provider result without relying on an event.
  await db.query('begin');
  await db.query('delete from private.payment_events where attempt_id=$1',[attempt.id]);
  await db.query("update public.payment_attempts set state='open' where id=$1",[attempt.id]);
  await db.query("update public.bookings set state='held' where id=$1 and owner_id=$2",[id,users[0].id]);
  await db.query("insert into private.payment_jobs(attempt_id,next_attempt_at) values($1,now()) on conflict(attempt_id) do update set next_attempt_at=now(),lease_token=null,lease_until=null",[attempt.id]);
  await db.query('commit');
  const reconciled=await context.request.get(`/api/bookings/${id}`);expect(reconciled.status()).toBe(200);
  const restored=await reconciled.json();expect(restored.payment.state).toBe('paid');expect(restored.booking.state).toBe('confirmed');
  evidence.controlledMissedWebhookAuthoritativeReconciliation='PASSED';
  // Assigned administration comes from protected database roles, never metadata.
  await db.query("insert into private.app_roles(user_id,role) values($1,'admin')",[users[1].id]);
  expect((await other.request.post('/api/admin/recovery',{headers,data:{bookingId:id}})).status()).toBe(200);
  await db.query('delete from private.app_roles where user_id=$1',[users[1].id]);
  evidence.explicitAssignedAdminRecovery='PASSED';
  await page.reload();await expect(page.getByTestId('booking-state')).toContainText('confirmed');
  expect((await other.request.post(`/api/bookings/${id}/cancellation`,{headers,data:{reason:'not my booking'}})).status()).toBe(403);
  await page.getByLabel('Reason for cancellation request').fill('Isolated sandbox customer cancellation request');
  await page.getByRole('button',{name:'Request cancellation',exact:true}).click();await expect(page.getByTestId('cancellation-state')).toContainText('pending');
  const duplicateCancellation=await context.request.post(`/api/bookings/${id}/cancellation`,{headers,data:{reason:'retry same pending request'}});expect(duplicateCancellation.status()).toBe(201);
  expect((await db.query('select count(*)::int as n from public.cancellation_requests where booking_id=$1',[id])).rows[0].n).toBe(1);
  expect((await db.query('select active from public.allocations where booking_id=$1',[id])).rows[0].active).toBe(true);
  await expect(page.getByTestId('booking-state')).toContainText('confirmed');evidence.customerCancellationDoesNotReleaseOrRefund='PASSED';
  const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.map(v=>v.id)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  mkdirSync('docs/screenshots',{recursive:true});await page.screenshot({path:`docs/screenshots/m2-confirmed-${info.project.name}.png`,fullPage:true});
  await page.goto('/account');await expect(page.locator(`[data-booking-id="${id}"]`)).toContainText('paid');
  evidence.authenticatedHostedPayment='PASSED';evidence.authoritativeConfirmationAndHistory='PASSED';evidence.customerIsolationAndRestrictions='PASSED';evidence.naturalSignedWebhook='PASSED';evidence.browserReturnCannotConfirm='PASSED';
  // Controlled local loss of allocation before a genuine provider payment.
  // This fault is injected ONLY into this run's booking, not a production path.
  const late={...selection,resource:resources['OPEN-15']};await page.goto(visitDestination(late));
  const lateResponsePromise=page.waitForResponse(r=>r.url().endsWith('/api/checkout')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Reserve with sandbox payment'}).click();const lateResponse=await lateResponsePromise;expect(lateResponse.status()).toBe(201);
  const lateBody=await lateResponse.json();const lateID=lateBody.booking.id;bookings.push(lateID);await expect(page).toHaveURL(new RegExp(`/booking/${lateID}`));
  await db.query('begin');await db.query('update public.allocations set active=false where booking_id=$1',[lateID]);await db.query("update public.bookings set state='expired' where id=$1 and owner_id=$2",[lateID,users[0].id]);await db.query('commit');
  const interval=intervalFromSelection(date,11,1);
  const competitor=await other.request.post('/api/holds',{headers,data:{resourceId:late.resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID()}});expect(competitor.status()).toBe(201);
  const competingID=(await competitor.json()).booking.id;
  // Suppress only this fixture browser's automatic status reads so the controlled
  // lost-refund-response can be injected before normal deployed reconciliation.
  await page.route('**/api/bookings/*',route=>route.abort());
  await pay(page);
  let lateState=(await db.query('select state from public.payment_attempts where booking_id=$1',[lateID])).rows[0].state;
  if(lateState==='open') {expect((await context.request.get(`/api/bookings/${lateID}`)).status()).toBe(200);lateState=(await db.query('select state from public.payment_attempts where booking_id=$1',[lateID])).rows[0].state;}
  expect(lateState).toBe('refund_required');
  let lostRefundID='';
  const lostRefund:typeof fetch=async(input,init)=>{
    const response=await fetch(input,init);
    if(String(input)==='https://api.stripe.com/v1/refunds'&&init?.method==='POST'&&response.ok) {
      lostRefundID=(await response.clone().json()).id;throw new Error('Controlled lost response after actual sandbox refund');
    }return response;
  };
  const refundHandler=paymentHandler({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey:process.env.SUPABASE_SECRET_KEY!,stripeKey:process.env.STRIPE_SECRET_KEY!,workerToken:process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN!,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET!,origin},lostRefund);
  const faultResponse=await refundHandler(new Request(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:lateID})}));
  expect(faultResponse.status).toBe(503);expect(Boolean(lostRefundID)).toBe(true);
  await expect.poll(async()=>{const r=await context.request.get(`/api/bookings/${lateID}`);expect(r.status()).toBe(200);return(await r.json()).payment.refund_state;},{timeout:60000}).toBe('succeeded');
  const latePayment=(await db.query('select id,state,refund_state,refund_id,amount_kobo from public.payment_attempts where booking_id=$1',[lateID])).rows[0];expect(latePayment.state).toBe('refunded');
  expect(latePayment.refund_id).toBe(lostRefundID);await page.unroute('**/api/bookings/*');
  const refund=await stripe.refunds.retrieve(latePayment.refund_id);expect(refund.status).toBe('succeeded');expect(refund.amount).toBe(80000);expect(refund.currency).toBe('ngn');
  expect((await db.query('select active from public.allocations where booking_id=$1',[competingID])).rows[0].active).toBe(true);
  expect((await db.query('select state from public.bookings where id=$1',[lateID])).rows[0].state).toBe('expired');
  const fakeEvent={id:`evt_${randomUUID().replaceAll('-','')}`,type:'checkout.session.expired',livemode:false,data:{object:{metadata:{palmsteeze_payment_id:latePayment.id,palmsteeze_environment:'development'}}}};
  const payload=JSON.stringify(fakeEvent);const signature=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET!});
  expect((await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/webhook`,{method:'POST',headers:{'Stripe-Signature':signature,'Content-Type':'application/json'},body:payload})).status).toBe(200);
  expect((await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:lateID})})).status).toBe(200);
  expect((await db.query('select state from private.payment_events where event_id=$1',[fakeEvent.id])).rows[0].state).toBe('processed');
  expect((await db.query('select state from public.payment_attempts where booking_id=$1',[lateID])).rows[0].state).toBe('refunded');
  expect((await other.request.delete(`/api/holds/${competingID}`,{headers})).status()).toBe(204);
  expect((await db.query('select active from public.allocations where booking_id=$1',[competingID])).rows[0].active).toBe(false);
  await page.goto(`/booking/${lateID}`);await expect(page.getByTestId('refund-state')).toContainText('succeeded');
  await page.screenshot({path:`docs/screenshots/m2-refunded-${info.project.name}.png`,fullPage:true});
  evidence.lateRealPaymentFullRefund='PASSED';evidence.lostRefundResponseIdempotentRetry='PASSED';evidence.competingAllocationPreserved='PASSED';evidence.controlledOutOfOrderEvent='PASSED';
  evidence.faultInjection='Missing local webhook receipt/state, allocation loss and out-of-order signed event deliberately injected. Hosted payments, reconciliation retrieval and Stripe refund are genuine sandbox operations.';
 } finally {await other.close();await anon.close();}
});
