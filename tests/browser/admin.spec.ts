import {ensureEntrance,reservationHeaders,waitForReservationSecurity} from './reservation-security';
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
import {selectChoice} from './select-choice';
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
test.describe.configure({mode:'serial',timeout:1800000});
const origin='http://localhost:3000';const headers={Origin:origin};
type User={id:string;email:string;password:string};
let db:Client;let stripe:Stripe;let auth:SupabaseClient;const users:User[]=[];const bookingIDs:string[]=[];const closureIDs:string[]=[];const rateIDs:string[]=[];const evidence:Record<string,unknown>={};
let resourceOriginal:{id:string;active:boolean}|undefined;
async function signIn(context:BrowserContext,user:User) {
 await ensureEntrance(context);
 const jar=new Map<string,string>();const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
 expect(Boolean((await client.auth.signInWithPassword({email:user.email,password:user.password})).data.session)).toBe(true);expect((await client.auth.getUser()).data.user?.id).toBe(user.id);
 await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
}
async function pay(page:Page,card:string) {
 await page.getByRole('link',{name:'Continue to test payment'}).click();await page.locator('#email').fill(`m3-${randomUUID()}@palmsteeze.invalid`);
 await page.locator('#cardNumber').fill(card);await page.locator('#cardExpiry').fill('1234');await page.locator('#cardCvc').fill('123');
 if(await page.locator('#billingName').isVisible()) await page.locator('#billingName').fill('PalmSteeze sandbox administration fixture');
 if(await page.locator('#billingPostalCode').isVisible()) await page.locator('#billingPostalCode').fill('10001');
 await page.locator('button[type=submit]').click();await page.waitForURL(/http:\/\/localhost:3000\/booking\//,{timeout:90000});await expect(page.getByTestId('booking-state')).toContainText('confirmed',{timeout:30000});
}
test.beforeAll(async()=>{
 await verifyProject();stripe=await verifiedStripeSandbox();db=await connectDatabase();await inspectDatabase(db);
 auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 for(let i=0;i<2;i++) {const email=`m3-browser-${randomUUID()}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');const created=await auth.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin',full_name:i?'PalmSteeze fixture administrator':'PalmSteeze fixture customer'}});expect(Boolean(created.data.user)).toBe(true);users.push({id:created.data.user!.id,email,password});}
 await db.query("insert into private.app_roles(user_id,role) values($1,'admin')",[users[1].id]);mkdirSync('.tools/private',{recursive:true});writeFileSync('.tools/private/m3-browser-fixtures.json',JSON.stringify(users));
});
test.afterAll(async()=>{
 if(!db) return;const ids=users.map(u=>u.id);const attempts=(await db.query('select * from public.payment_attempts where owner_id=any($1::uuid[])',[ids])).rows;
 for(const a of attempts) if(a.session_id) {
  const session=await stripe.checkout.sessions.retrieve(a.session_id,{expand:['payment_intent']});if(session.status==='open') await stripe.checkout.sessions.expire(session.id);
  if(session.payment_status==='paid') {
   const intent=session.payment_intent as Stripe.PaymentIntent;let refunds=await stripe.refunds.list({payment_intent:intent.id});
   if(!refunds.data.length) {await stripe.refunds.create({payment_intent:intent.id,amount:intent.amount_received,metadata:{palmsteeze_payment_id:a.id,palmsteeze_environment:'development'}},{idempotencyKey:`palmsteeze-m3-cleanup-${a.id}`});refunds=await stripe.refunds.list({payment_intent:intent.id});}
   // Async-failure test card intentionally cannot return funds. Only this
   // documented fixture may be cleaned after its authoritative failed result.
   const knownFailed=refunds.data.length>0&&refunds.data.every(r=>r.status==='failed'||r.status==='canceled');
   if(!knownFailed) await expect.poll(async()=>{refunds=await stripe.refunds.list({payment_intent:intent.id});return refunds.data.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0);},{timeout:90000}).toBe(intent.amount_received);
  }
 }
 await db.query('begin');
 if(resourceOriginal) {
  const latest=(await db.query("select actor_id from public.admin_audit where target_id=$1 and action='resource_updated' order by created_at desc limit 1",[resourceOriginal.id])).rows[0];
  if(latest?.actor_id===users[1].id) await db.query('update public.resources set active=$2 where id=$1',[resourceOriginal.id,resourceOriginal.active]);
 }
 await db.query('delete from public.admin_audit where actor_id=any($1::uuid[]) or target_id=any($2::uuid[])',[ids,[...bookingIDs,...closureIDs]]);
 await db.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
 await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from private.payment_jobs where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
 await db.query('delete from public.payment_attempts where owner_id=any($1::uuid[])',[ids]);await db.query('delete from public.cancellation_requests where owner_id=any($1::uuid[])',[ids]);
 await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=any($1::uuid[])) or id=any($2::uuid[])',[ids,closureIDs]);await db.query('delete from public.bookings where owner_id=any($1::uuid[])',[ids]);
 await db.query('delete from public.resource_rates where id=any($1::uuid[])',[rateIDs]);await db.query('delete from private.app_roles where user_id=any($1::uuid[])',[ids]);await db.query('commit');
 for(const user of users) expect((await auth.auth.admin.deleteUser(user.id)).error).toBeNull();await db.end();mkdirSync('docs/evidence',{recursive:true});writeFileSync(`docs/evidence/m3-browser-${test.info().project.name}.json`,JSON.stringify({checkedAt:new Date().toISOString(),...evidence,fixtureCleanup:'PASSED'},null,2)+'\n');
});
test('admin decisions real refunds pending failure recovery spaces closures audit and restrictions',async({page,context,browser},info)=>{
 await signIn(context,users[1]);const customer=await browser.newContext({baseURL:origin});const customerPage=await customer.newPage();await signIn(customer,users[0]);const anon=await browser.newContext({baseURL:origin});await ensureEntrance(anon);
 const action=async(data:Record<string,unknown>)=>context.request.post('/api/admin/actions',{headers,data});
 try {
  mkdirSync('docs/screenshots/m4-v2',{recursive:true});
  async function prepareCapture(target:Page) {
   await target.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});
   await expect.poll(()=>target.evaluate(()=>window.scrollY)).toBe(0);await target.evaluate(()=>document.fonts.ready);
   const a11y=await new AxeBuilder({page:target}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.map(v=>v.id)).toEqual([]);
   expect(await target.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
  await customerPage.goto('/account');await expect(customerPage.getByRole('heading',{name:'Your next good workday awaits.'})).toBeVisible();await prepareCapture(customerPage);await customerPage.screenshot({path:`docs/screenshots/m4-v2/customer-empty-${info.project.name}.png`,fullPage:true,animations:'disabled',mask:[customerPage.getByTestId('customer-identity')],maskColor:'#D9DFD4'});
  expect((await customer.request.post('/api/admin/actions',{headers,data:{operation:'hours',opensHour:8,closesHour:20,reason:'forged admin'}})).status()).toBe(403);
  expect((await anon.request.post('/api/admin/actions',{headers,data:{}})).status()).toBe(401);
  expect((await customer.request.get('/admin')).status()).toBe(404);expect((await context.request.post('/api/admin/actions',{headers:{Origin:'https://evil.example'},data:{}})).status()).toBe(403);
  expect((await context.request.post('/api/admin/actions',{headers:{...headers,Authorization:'Bearer invalid'},data:{}})).status()).toBe(401);
  await page.goto('/admin');await expect(page.getByRole('heading',{name:'A clear view of today.'})).toBeVisible();expect((await context.request.get('/admin')).headers()['cache-control']).toContain('no-store');
  evidence.serverAndDatabaseAssignedAdmin='PASSED';
  const resource=(await db.query("select * from public.resources where code='OPEN-11'")).rows[0];const date=initialBookingDate(new Date(Date.now()+21*86400000));
  resourceOriginal={id:resource.id,active:resource.active};
  const selection={resource:resource.id,date,hour:10,duration:1};
  const firstInterval=intervalFromSelection(date,10,1);const qs=new URLSearchParams({resource:resource.id,start:firstInterval.starts_at,end:firstInterval.ends_at});const authoritative=(await(await customer.request.get(`/api/quote?${qs}`)).json()).quote;
  const expectedQuote=JSON.stringify(Object.fromEntries(['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'].map(k=>[k,authoritative[k]])));
  for(const amountKobo of ['79999','200001','80000.1','8e4',80000]) expect((await customer.request.post('/api/checkout',{headers:{...headers,...await reservationHeaders(customer,visitDestination(selection))},data:{resourceId:resource.id,startsAt:firstInterval.starts_at,endsAt:firstInterval.ends_at,requestId:randomUUID(),expectedQuote,amountKobo}})).status()).toBe(400);
  expect((await db.query('select count(*)::int as n from public.bookings where owner_id=$1',[users[0].id])).rows[0].n).toBe(0);evidence.applicationAmountValidationAndRollback='PASSED';
  const variants=[{card:'4242424242424242',kind:'success'},{card:'4000000000007726',kind:'pending'},{card:'4242424242424242',kind:'full'}];
  // The optional provider-failure gate retains its real failed-result and
  // replacement assertions. It is separate from the core administration flow
  // because Stripe does not document a bounded simulator transition time.
  if(process.env.PALMSTEEZE_ADMIN_ASYNC_REFUND_PROOF==='true') variants.push({card:'4000000000005126',kind:'failure'});
  else evidence.actualAsyncRefundFailureAndReplacement='NOT RUN: separate provider-failure gate; ten-minute observation did not establish failure';
  for(let i=0;i<variants.length;i++) {
   const variant=variants[i];const selected={...selection,hour:10+i*2};await customerPage.goto(visitDestination(selected));
   const expectedAmount=variant.kind==='pending' ? 100001:variant.kind==='full' ? 200000:80000;
   if(variant.kind==='pending'){await customerPage.getByRole('radio',{name:/Custom amount/}).check();await customerPage.getByLabel('Payment amount in naira').fill('799.99');await expect(customerPage.getByRole('button',{name:'Continue to test payment'})).toBeDisabled();await prepareCapture(customerPage);await customerPage.screenshot({path:`docs/screenshots/m4-v2/payment-invalid-disabled-${info.project.name}.png`,fullPage:true,animations:'disabled'});await customerPage.getByLabel('Payment amount in naira').fill('1000.01');}
   if(variant.kind==='full') await customerPage.getByRole('radio',{name:/Full payment/}).check();
   await customerPage.screenshot({path:`docs/screenshots/m3-payment-choice-${info.project.name}.png`,fullPage:true});
   if(variant.kind==='full') {await prepareCapture(customerPage);await customerPage.screenshot({path:`docs/screenshots/m4-v2/payment-review-full-${info.project.name}.png`,fullPage:true,animations:'disabled'});}
   const promise=customerPage.waitForResponse(r=>r.url().endsWith('/api/checkout')&&r.request().method()==='POST');await waitForReservationSecurity(customerPage);await customerPage.getByRole('button',{name:'Continue to test payment'}).click();const result=await promise;expect([201,202]).toContain(result.status());const detail=await result.json();if(result.status()===202) expect(detail.payment.state).toBe('creating');const id=detail.booking.id;bookingIDs.push(id);expect(detail.payment.amount_kobo).toBe(expectedAmount);expect(detail.booking.deposit_kobo).toBe(80000);expect(detail.booking.balance_kobo).toBe(120000);
   await expect(customerPage).toHaveURL(new RegExp(`/booking/${id}`));await expect(customerPage.getByRole('link',{name:'Continue to test payment'})).toBeVisible({timeout:90000});await pay(customerPage,variant.card);
   const verified=(await db.query('select amount_kobo,collected_kobo,refunded_kobo,payment_intent_id from public.payment_attempts where booking_id=$1',[id])).rows[0];expect(Number(verified.collected_kobo)).toBe(expectedAmount);await expect(customerPage.locator('.quote-summary')).toContainText(variant.kind==='pending'?'₦1,000.01':variant.kind==='full'?'₦2,000':'₦800');
   if(variant.kind==='full') {
    await customerPage.goto('/account');await prepareCapture(customerPage);await customerPage.screenshot({path:`docs/screenshots/m4-v2/customer-bookings-${info.project.name}.png`,fullPage:true,animations:'disabled',mask:[customerPage.getByTestId('customer-identity')],maskColor:'#D9DFD4'});await customerPage.goto(`/booking/${id}`);
    await page.goto('/admin');await page.getByLabel('Search bookings',{exact:true}).fill(users[0].email);await expect(page.getByRole('list',{name:'Bookings'}).getByRole('listitem')).toHaveCount(3);await prepareCapture(page);await page.screenshot({path:`docs/screenshots/m4-v2/admin-real-overview-${info.project.name}.png`,fullPage:true,animations:'disabled',mask:[page.locator('.metric-card > strong'),page.locator('.metric-accent > p'),page.locator('.operation-note > strong'),page.locator('.attention-panel h3'),page.locator('.attention-amount'),page.locator('.day-operations strong'),page.locator('.list-note')],maskColor:'#D9DFD4'});
    evidence.redesignScreenshots='Actual authenticated app with isolated synthetic customer; real overview filtered to three run-owned records, stored aggregate figures masked. No invented live metrics.';
    // Actual prior partial refund on this run-owned full-payment charge. This
    // is a provider fixture, not a customer partial-refund product feature.
    const prior=await stripe.refunds.create({payment_intent:verified.payment_intent_id,amount:20000,metadata:{palmsteeze_fixture:'prior-partial'}},{idempotencyKey:`palmsteeze-m3-prior-partial-${id}`});expect(prior.status).toBe('succeeded');
   }
   expect((await customer.request.post(`/api/bookings/${id}/cancellation`,{headers,data:{reason:`Isolated M3 ${variant.kind} request`}})).status()).toBe(201);
   let cancellation=(await db.query("select id from public.cancellation_requests where booking_id=$1 and state='pending'",[id])).rows[0].id;
   await page.goto(`/admin/bookings/${id}`);
   if(i===0) {
    await page.getByLabel('Reason for reject cancellation').fill('Fixture rejection preserves the paid booking');await page.getByRole('button',{name:'Reject cancellation',exact:true}).click();await expect(page.getByTestId('admin-cancellation-state')).toContainText('rejected');
    expect((await db.query('select active from public.allocations where booking_id=$1',[id])).rows[0].active).toBe(true);await expect(page.getByTestId('admin-booking-state')).toContainText('confirmed');evidence.rejectionPreservesBooking='PASSED';
    const interval=intervalFromSelection(date,10,1);const conflict=await action({operation:'closure',resourceId:resource.id,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID(),reason:'Fixture conflict'});expect(conflict.status()).toBe(409);expect((await conflict.json()).affected.some((a:{bookingId:string})=>a.bookingId===id)).toBe(true);
    const archive=await action({operation:'resource',resourceId:resource.id,name:resource.name,description:resource.description,active:false,reason:'Fixture archive conflict'});expect(archive.status()).toBe(409);
    await customerPage.reload();await expect(customerPage.getByTestId('cancellation-state')).toContainText('rejected');await customerPage.getByLabel('Reason for cancellation request').fill('New isolated approval request after rejection');const again=customerPage.waitForResponse(r=>r.url().endsWith('/cancellation')&&r.request().method()==='POST');await customerPage.getByRole('button',{name:'Request cancellation',exact:true}).click();expect((await again).status()).toBe(201);await expect(customerPage.getByTestId('cancellation-state')).toHaveCount(2);await expect(customerPage.getByRole('button',{name:'Request cancellation',exact:true})).toHaveCount(0);
    cancellation=(await db.query("select id from public.cancellation_requests where booking_id=$1 and state='pending'",[id])).rows[0].id;await page.reload();evidence.customerRepeatRequestUIAndHistory='PASSED';
   }
   // Isolate this fixture from the minute runner while inspecting durable
   // pending state, then release its lease for the genuine deployed worker.
   const attempt=(await db.query('select id,payment_intent_id from public.payment_attempts where booking_id=$1',[id])).rows[0];
   await db.query("insert into private.payment_jobs(attempt_id,lease_token,lease_until) values($1,$2,now()+interval '5 minutes') on conflict(attempt_id) do update set lease_token=$2,lease_until=now()+interval '5 minutes'",[attempt.id,randomUUID()]);
   await page.getByLabel('Reason for approve and queue full refund').fill('Isolated admin approval for full collected-payment refund');await page.getByRole('button',{name:'Approve and queue full refund',exact:true}).click();await expect(page.getByTestId('admin-cancellation-state').filter({hasText:'approved'})).toBeVisible();await expect(page.getByTestId('admin-booking-state')).toContainText('cancelled');
   await expect(page.getByText(`Email: ${users[0].email}`,{exact:true}).first()).toBeVisible();await expect(page.getByText(`Email: ${users[1].email}`,{exact:true}).first()).toBeVisible();await expect(page.getByText(`Stable user ID: ${users[1].id}`,{exact:true}).first()).toBeVisible();await expect(page.getByText(/Decision timestamp:/).first()).toBeVisible();await page.screenshot({path:`docs/screenshots/m3-identities-${info.project.name}.png`,fullPage:true});evidence.administratorOnlyIdentityAttribution='PASSED';
   await expect(page.getByText('Customer at request: PalmSteeze fixture customer',{exact:true}).first()).toBeVisible();await expect(page.getByText('Acting administrator at decision: PalmSteeze fixture administrator',{exact:true}).first()).toBeVisible();
   const duplicate=await action({operation:'decide',requestId:cancellation,approve:true,reason:'Repeated isolated approval'});expect(duplicate.status()).toBe(200);
   expect((await db.query('select count(*)::int as n from public.refund_operations where attempt_id=$1',[attempt.id])).rows[0].n).toBe(1);
   if(i===0) {await page.goto('/admin/recovery');await expect(page.locator(`[data-payment-id="${attempt.id}"]`)).toContainText('Refund: required');await page.screenshot({path:`docs/screenshots/m3-pending-${info.project.name}.png`,fullPage:true});}
   await db.query('update private.payment_jobs set lease_token=null,lease_until=null,next_attempt_at=now() where attempt_id=$1',[attempt.id]);
   expect((await context.request.post('/api/admin/recovery',{headers,data:{bookingId:id}})).status()).toBe(200);
   if(variant.kind==='pending') {
    const actual=await stripe.refunds.list({payment_intent:attempt.payment_intent_id});expect(actual.data.some(r=>r.status==='pending')).toBe(true);evidence.actualPendingRefund='PASSED';
    expect((await db.query('select refund_state from public.payment_attempts where id=$1',[attempt.id])).rows[0].refund_state).toBe('pending');await page.goto('/admin/recovery');await expect(page.locator(`[data-payment-id="${attempt.id}"]`)).toContainText('Refund: pending');await page.screenshot({path:`docs/screenshots/m3-pending-${info.project.name}.png`,fullPage:true});
   }
   if(variant.kind==='failure') {
    await expect.poll(async()=>{const list=await stripe.refunds.list({payment_intent:attempt.payment_intent_id});return list.data[0]?.status;},{timeout:600000,intervals:[2000,5000,10000]}).toBe('failed');
    // Read-only provider verification is retried by the assigned administrator;
    // no new refund is created until a separately requested failed-refund retry.
    await db.query('insert into private.payment_jobs(attempt_id) values($1) on conflict(attempt_id) do update set next_attempt_at=now()',[attempt.id]);
    expect((await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:id})})).status).toBe(200);
    await page.goto('/admin/recovery');await expect(page.locator(`[data-payment-id="${attempt.id}"]`)).toContainText('Refund: failed');await page.screenshot({path:`docs/screenshots/m3-failed-${info.project.name}.png`,fullPage:true});
    evidence.actualAsyncRefundFailure='PASSED';
    const replay=await action({operation:'decide',requestId:cancellation,approve:true,reason:'Repeat must not create replacement'});expect(replay.status()).toBe(200);expect((await stripe.refunds.list({payment_intent:attempt.payment_intent_id})).data.length).toBe(1);
    const failedCard=page.locator(`[data-payment-id="${attempt.id}"]`);await failedCard.getByLabel('Reason for retry provider verification').fill('Explicit isolated retry after actual failed refund');await failedCard.getByRole('button',{name:'Retry provider verification'}).click();
    await expect(failedCard.getByRole('status')).toContainText('Saved.');
    expect((await action({operation:'recover',bookingId:id,reason:'Duplicate queued retry must reuse replacement'})).status()).toBe(200);
    expect((await context.request.post('/api/admin/recovery',{headers,data:{bookingId:id}})).status()).toBe(200);
    await expect.poll(async()=>{const list=await stripe.refunds.list({payment_intent:attempt.payment_intent_id});return list.data.length===2&&list.data.every(r=>r.status==='failed');},{timeout:600000,intervals:[2000,5000,10000]}).toBe(true);
    const operations=(await db.query('select generation from public.refund_operations where attempt_id=$1 order by generation',[attempt.id])).rows.map(r=>r.generation);expect(operations).toEqual([0,1]);evidence.verifiedFailedRefundReplacementAndDuplicateRetry='PASSED';
   } else {
    await expect.poll(async()=>{await context.request.post('/api/admin/recovery',{headers,data:{bookingId:id}});return(await db.query('select refund_state from public.payment_attempts where id=$1',[attempt.id])).rows[0].refund_state;},{timeout:600000,intervals:[2000,5000,10000]}).toBe('succeeded');
    const refunds=await stripe.refunds.list({payment_intent:attempt.payment_intent_id});expect(refunds.data.length).toBe(variant.kind==='full'?2:1);expect(refunds.data.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0)).toBe(expectedAmount);
    if(variant.kind==='full'){expect(refunds.data.map(r=>r.amount).sort((a,b)=>a-b)).toEqual([20000,180000]);evidence.actualFullPaymentPriorPartialAndRemainingRefund='PASSED';}
    const amounts=(await db.query('select collected_kobo,refunded_kobo from public.payment_attempts where id=$1',[attempt.id])).rows[0];expect(Number(amounts.refunded_kobo)).toBe(expectedAmount);expect(Number(amounts.collected_kobo)).toBe(expectedAmount);evidence.actualMinimumHigherFullPaymentsAndRepeatSafety='PASSED';
    if(i===0) {
     // Controlled run-owned local-state corruption, not a Stripe failed-refund
     // claim. Recovery must retrieve the actual succeeded refund and must never
     // create a replacement just because local state says failed.
     await db.query('begin');await db.query("update public.payment_attempts set state='review_required',refund_state='failed' where id=$1",[attempt.id]);await db.query("update public.refund_operations set state='failed' where attempt_id=$1",[attempt.id]);await db.query('commit');
     await page.goto('/admin/recovery');const card=page.locator(`[data-payment-id="${attempt.id}"]`);await expect(card).toContainText('Refund: failed');await page.screenshot({path:`docs/screenshots/m3-failed-${info.project.name}.png`,fullPage:true});
     await card.getByLabel('Reason for retry provider verification').fill('Controlled local-state fixture: verify actual provider result');await card.getByRole('button',{name:'Retry provider verification'}).click();await expect(card.getByRole('status')).toContainText('Saved.');
     expect((await action({operation:'recover',bookingId:id,reason:'Repeat verification of isolated fixture'})).status()).toBe(200);expect((await context.request.post('/api/admin/recovery',{headers,data:{bookingId:id}})).status()).toBe(200);
     await expect.poll(async()=> (await db.query('select refund_state from public.payment_attempts where id=$1',[attempt.id])).rows[0].refund_state,{timeout:30000}).toBe('succeeded');
     expect((await stripe.refunds.list({payment_intent:attempt.payment_intent_id})).data.length).toBe(1);expect((await db.query('select generation from public.refund_operations where attempt_id=$1',[attempt.id])).rows.map(r=>r.generation)).toEqual([0]);
     expect((await db.query('select refund_retry_requested from public.payment_attempts where id=$1',[attempt.id])).rows[0].refund_retry_requested).toBe(false);
     expect((await db.query('select state from public.bookings where id=$1',[id])).rows[0].state).toBe('cancelled');evidence.failedScreenAndAuthoritativeRecovery='PASSED (controlled local-state fault; real Stripe succeeded result, no replacement)';
    }
   }
  }
  const interval=intervalFromSelection(date,18,1);await page.goto('/admin/availability');
  await selectChoice(page,'Space',resource.id);await page.getByLabel('Closure start (Lagos)').fill(`${date}T18:00`);await page.getByLabel('Closure end (Lagos)').fill(`${date}T19:00`);await page.getByLabel('Reason for create closure').fill('Isolated M3 closure');
  let closureResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/actions')&&r.request().method()==='POST');await page.getByRole('button',{name:'Create closure',exact:true}).click();let closure=await closureResponse;expect(closure.status()).toBe(200);const closureID=(await closure.json()).id;closureIDs.push(closureID);
  closureResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/actions')&&r.request().method()==='POST');await page.getByRole('button',{name:'Create closure',exact:true}).click();closure=await closureResponse;expect((await closure.json()).id).toBe(closureID);
  const blocked=await customer.request.post('/api/holds',{headers:{...headers,...await reservationHeaders(customer,visitDestination({resource:resource.id,date,hour:18,duration:1}))},data:{resourceId:resource.id,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID()}});expect(blocked.status()).toBe(409);
  await page.goto('/admin/availability');await page.screenshot({path:`docs/screenshots/m3-availability-${info.project.name}.png`,fullPage:true});
  const closureCard=page.locator('section.admin-card').filter({has:page.getByText('Isolated M3 closure',{exact:true})});await closureCard.getByLabel('Reason for remove closure').fill('Isolated closure removal');await closureCard.getByRole('button',{name:'Remove closure'}).click();await expect(closureCard).toContainText('Removed');
  expect((await action({operation:'removeClosure',closureId:closureID,reason:'Repeated isolated closure removal'})).status()).toBe(200);
  await page.goto('/admin/spaces');await page.locator('details.resource-detail').filter({hasText:resource.code}).locator('summary').click();await expect(page.locator('details[open]').getByLabel('Resource name')).toHaveValue(resource.name);
  const resourceCard=page.locator('details[open]');
  for(const active of ['false','true']) {await resourceCard.getByLabel('Resource status').click();await page.locator('[role=option][data-value="'+active+'"]').click();await resourceCard.getByLabel('Reason for save resource').fill(active==='false' ? 'Isolated archive after allocations cancelled':'Restore isolated resource');const resultPromise=page.waitForResponse(r=>r.url().endsWith('/api/admin/actions')&&r.request().method()==='POST');await resourceCard.getByRole('button',{name:'Save resource'}).click();expect((await resultPromise).status()).toBe(200);}
  await resourceCard.getByLabel('Hourly price in naira').fill('2300');await resourceCard.getByLabel('Effective date/time (Lagos)').fill(`${date}T08:00`);await resourceCard.getByLabel('Reason for schedule future rate').fill('Isolated future rate');
  const ratePromise=page.waitForResponse(r=>r.url().endsWith('/api/admin/actions')&&r.request().method()==='POST');await resourceCard.getByRole('button',{name:'Schedule future rate'}).click();const rate=await ratePromise;expect(rate.status()).toBe(200);rateIDs.push((await rate.json()).id);
  await page.goto('/admin/audit');await expect(page.getByRole('heading',{name:'cancellation approved'}).first()).toBeVisible();evidence.closuresArchivesFutureRatesAndAudit='PASSED';
  await page.goto('/admin');const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.map(v=>v.id)).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`docs/screenshots/m3-overview-${info.project.name}.png`,fullPage:true});evidence.desktopMobileAccessibility='PASSED';
  evidence.providerBasis='Hosted charges/refunds and pending-to-succeeded transitions are actual Stripe sandbox operations. Failed-screen recovery uses explicitly controlled local-state corruption and actual authoritative Stripe success. Actual asynchronous failure/replacement is a separate optional gate; no provider failure is fabricated.';
  evidence.completeCoreAdminFlow='PASSED';
 } finally {await customer.close();await anon.close();}
});
