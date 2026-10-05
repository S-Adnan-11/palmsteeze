// Resumable real-provider proof. Never remove a fixture in a finally block:
// Stripe's asynchronous simulator has no documented transition deadline.
// A prepared ledger is not a provider refund. archive-blocked captures complete
// evidence after a definitive provider rejection and leaves the gate FAILED.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {chromium,type BrowserContext} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import type {Client} from 'pg';
import {verifyProject,connectDatabase,inspectDatabase,safeFailure} from './lib/database';
import {verifiedStripeSandbox} from './lib/stripe-sandbox';
import {initialBookingDate,intervalFromSelection} from '../src/lib/domain';
import {paymentHandler} from '../supabase/functions/palmsteeze-payments/index';

type Identity={id:string;email:string;password:string};
type Journal={startedAt:string;phase:string;customer?:Identity;admin?:Identity;bookingId?:string;attemptId?:string;requestId?:string;baseline:Record<string,string>;observations:unknown[];checks?:Record<string,unknown>};
const restored=process.argv.includes('restored');
const revised=restored||process.argv.includes('revised');
const path=restored?'.tools/private/m3-restored-refund-proof.json':revised?'.tools/private/m3-revised-refund-proof.json':'.tools/private/m3-retained-refund-proof.json';
const evidencePath=restored?'docs/evidence/m3-restored-refund-provider.json':revised?'docs/evidence/m3-revised-refund-provider.json':'docs/evidence/m3-retained-refund-proof.json';
const origin='http://localhost:3000';
let journal:Journal;
const save=()=>writeFileSync(path,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function preserved(db:Client):Promise<Record<string,string>> {
 // Capture immutable history, not mutable operational states that a real
 // customer's legitimate concurrent activity may change during observation.
 const queries:Record<string,string>={
  booking:`select id,owner_id,resource_id,starts_at,ends_at,hourly_kobo,total_kobo,deposit_percent,deposit_kobo,balance_kobo,policy_snapshot from public.bookings order by id`,
  payment:`select id,booking_id,owner_id,amount_kobo,currency,created_at from public.payment_attempts order by id`,
  decision:`select id,booking_id,owner_id,reason,state,decided_by,decided_at,decision_reason from public.cancellation_requests where state<>'pending' order by id`,
  audit:`select * from public.admin_audit order by id`,
  identity:`select * from private.cancellation_identity order by request_id`,
 };
 const result:Record<string,string>={};
 for(const [name,sql] of Object.entries(queries)) for(const row of (await db.query(sql)).rows) {
  result[`${name}:${row.id||row.request_id}`]=digest(row);
 }
 return result;
}
async function checkPreservation(db:Client){
 const current=await preserved(db);for(const [key,value] of Object.entries(journal.baseline)) assert.equal(current[key],value,`Preexisting ${key.split(':')[0]} history changed`);
}
async function login(user:Identity){
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await client.auth.signInWithPassword({email:user.email,password:user.password});assert.equal(result.error,null);assert.ok(result.data.session);
 assert.equal((await client.auth.getUser()).data.user?.id,user.id);return result.data.session.access_token;
}
async function cookies(context:BrowserContext,user:Identity){
 const jar=new Map<string,string>();
 const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
 assert.ok((await client.auth.signInWithPassword({email:user.email,password:user.password})).data.session);
 assert.equal((await client.auth.getUser()).data.user?.id,user.id);
 await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
}
async function api(token:string,url:string,data:unknown){
 return fetch(origin+url,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
}
async function until(check:()=>Promise<boolean>,milliseconds=120000){
 const deadline=Date.now()+milliseconds;
 do {if(await check()) return;await new Promise(resolve=>setTimeout(resolve,3000));}while(Date.now()<deadline);
 throw new Error('Bounded integration assertion not satisfied; retained fixture remains available');
}
async function main(){
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();
 mkdirSync('.tools/private',{recursive:true});mkdirSync('docs/evidence',{recursive:true});
  const command=process.argv[2]||'observe';
  assert.ok(['prepare','observe','replace','diagnose','verify-blocked','capture','cleanup','archive-blocked'].includes(command));
 try {
  await inspectDatabase(db);
  if(existsSync(path)) journal=JSON.parse(readFileSync(path,'utf8'));
  else {assert.equal(command,'prepare');journal={startedAt:new Date().toISOString(),phase:'creating',baseline:await preserved(db),observations:[]};save();}
  await checkPreservation(db);
  journal.checks ||= {};
  // Early collector output counted prepared ledger rows as replacement proof.
  // Require an actual second provider object; retain the corrected observations.
  for(const item of journal.observations as {providerRefunds?:unknown[];replacement?:string}[])if(item.providerRefunds?.length===1&&item.replacement?.startsWith('PASSED'))item.replacement='NOT RUN — prepared ledger only; no actual provider replacement';
  const priorDiagnostic=journal.checks.realNetworkDiagnostic as {diagnostics?:{message?:string}[]}|undefined;
  priorDiagnostic?.diagnostics?.forEach(d=>{if(d.message)d.message=d.message.replace(/\b(?:card|pm)_[A-Za-z0-9_]+/g,'[provider reference withheld]');});
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  if(command==='prepare') {
   assert.ok(['creating','prepared'].includes(journal.phase),'Existing retained proof must not be replaced');
   for(const role of ['customer','admin'] as const) if(!journal[role]) {
    const email=`m3-retained-${role}-${randomUUID()}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');
    const made=await auth.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:`PalmSteeze retained proof ${role}`}});assert.equal(made.error,null);assert.ok(made.data.user);
    journal[role]={id:made.data.user.id,email,password};save();
   }
   // Explicit fixture-only role assignment; never infer owner role from metadata.
   await db.query("insert into private.app_roles(user_id,role) values($1,'admin') on conflict(user_id) do nothing",[journal.admin!.id]);
   const customerToken=await login(journal.customer!);const adminToken=await login(journal.admin!);
   assert.equal((await api(customerToken,'/api/admin/actions',{operation:'recover',bookingId:randomUUID(),reason:'Unauthorized proof'})).status,403);
   assert.equal((await api('invalid','/api/admin/actions',{})).status,401);
   if(!journal.bookingId) {
    const date=initialBookingDate(new Date(Date.now()+25*86400000));
    let chosen:{resourceId:string;startsAt:string;endsAt:string;expectedQuote:string}|undefined;
    for(const r of (await db.query("select id from public.resources where active and kind='open_desk' order by code")).rows){
     const interval=intervalFromSelection(date,12,1);
     if((await db.query('select 1 from public.allocations where resource_id=$1 and active and period&&tstzrange($2,$3,\'[)\')',[r.id,interval.starts_at,interval.ends_at])).rowCount) continue;
     const q=await fetch(`${origin}/api/quote?${new URLSearchParams({resource:r.id,start:interval.starts_at,end:interval.ends_at})}`,{headers:{Authorization:`Bearer ${customerToken}`}});assert.equal(q.status,200);const quote=(await q.json()).quote;
     chosen={resourceId:r.id,startsAt:interval.starts_at,endsAt:interval.ends_at,expectedQuote:JSON.stringify(Object.fromEntries(['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'].map(k=>[k,quote[k]])))};break;
    }
    assert.ok(chosen);journal.requestId=randomUUID();save();
    const response=await api(customerToken,'/api/checkout',{...chosen,requestId:journal.requestId});assert.ok([201,202].includes(response.status));const detail=await response.json();journal.bookingId=detail.booking.id;journal.attemptId=detail.payment.id;save();
   }
   const attempt=async()=>(await db.query('select * from public.payment_attempts where id=$1 and owner_id=$2',[journal.attemptId,journal.customer!.id])).rows[0];
   let a=await attempt();assert.ok(a);
   if(!a.payment_intent_id){
    const browser=await chromium.launch({channel:'chrome'});try{
     const context=await browser.newContext();await cookies(context,journal.customer!);const page=await context.newPage();
     await page.goto(`${origin}/booking/${journal.bookingId}`);const link=page.getByRole('link',{name:'Continue to secure Stripe sandbox checkout'});await link.waitFor({timeout:90000});await link.click();
     await page.locator('#email').fill(journal.customer!.email);await page.locator('#cardNumber').fill('4000000000005126');await page.locator('#cardExpiry').fill('1234');await page.locator('#cardCvc').fill('123');
     if(await page.locator('#billingName').isVisible()) await page.locator('#billingName').fill('PalmSteeze retained sandbox proof');
     if(await page.locator('#billingPostalCode').isVisible()) await page.locator('#billingPostalCode').fill('10001');
     await page.locator('button[type=submit]').click();await page.waitForURL(/http:\/\/localhost:3000\/booking\//,{timeout:90000});
    }finally{await browser.close();}
    await until(async()=>{a=await attempt();return a.state==='paid';});
   }
   const pi=await stripe.paymentIntents.retrieve(a.payment_intent_id);assert.equal(pi.livemode,false);assert.equal(pi.status,'succeeded');assert.equal(pi.currency,'ngn');assert.equal(pi.amount_received,Number(a.amount_kobo));
   const charge=await stripe.charges.retrieve(pi.latest_charge as string);assert.equal(charge.payment_method_details?.card?.last4,'5126');
   let cancellation=(await db.query('select * from public.cancellation_requests where booking_id=$1 order by created_at desc limit 1',[journal.bookingId])).rows[0];
   if(!cancellation){assert.equal((await api(customerToken,`/api/bookings/${journal.bookingId}/cancellation`,{reason:'Retained actual asynchronous provider-failure proof'})).status,201);cancellation=(await db.query('select * from public.cancellation_requests where booking_id=$1',[journal.bookingId])).rows[0];}
   assert.equal((await api(adminToken,'/api/admin/actions',{operation:'decide',requestId:cancellation.id,approve:true,reason:'Retained proof full collected-payment cancellation'})).status,200);
   await until(async()=>{const refunds=await stripe.refunds.list({payment_intent:pi.id,limit:100});return refunds.data.length===1;});
   await until(async()=>{a=await attempt();return a.refund_state==='succeeded'||a.refund_state==='failed';});
   assert.equal(Number(a.collected_kobo),pi.amount_received);assert.equal((await db.query('select active from public.allocations where booking_id=$1',[journal.bookingId])).rows[0].active,false);
   journal.phase='waiting-first-failure';save();console.log('PASSED: actual hosted card-ending-5126 payment and approved refund created; isolated database/Auth/history retained for delayed signed failure.');
   journal.checks.hostedPaymentAndInitialRefund='PASSED — actual hosted card-ending-5126, NGN, stored customer identity';save();
  }
  const a=(await db.query('select * from public.payment_attempts where id=$1',[journal.attemptId])).rows[0];assert.ok(a,'Retained proof booking/payment must still exist');
  const refunds=await stripe.refunds.list({payment_intent:a.payment_intent_id,limit:100});assert.equal(refunds.has_more,false);
  const operations=(await db.query('select generation,state,amount_kobo,refund_id,created_at,updated_at from public.refund_operations where attempt_id=$1 order by generation',[a.id])).rows;
  const events=(await db.query("select event_id,event_type,state,received_at,processed_at,payload from private.payment_events where attempt_id=$1 and event_type='refund.failed' order by received_at",[a.id])).rows;
  for(const e of events){const actual=await stripe.events.retrieve(e.event_id);assert.equal(actual.livemode,false);assert.equal(actual.type,'refund.failed');assert.equal(actual.data.object.id,e.payload.data.object.id);assert.equal(actual.data.object.status,'failed');assert.equal(actual.data.object.amount,Number(a.collected_kobo));assert.equal(e.payload.id,actual.id);assert.ok(refunds.data.some(r=>r.id===actual.data.object.id));}
  const successful=refunds.data.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0);const pending=refunds.data.filter(r=>r.status==='pending'||r.status==='requires_action').reduce((n,r)=>n+r.amount,0);
  assert.ok(successful+pending<=Number(a.collected_kobo));assert.ok(operations.every(r=>Number(r.amount_kobo)<=Number(a.collected_kobo)));
  if(command==='diagnose') {
   const token=await login(journal.admin!);const ct=await login(journal.customer!);
   const customerClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${ct}`}},auth:{persistSession:false,autoRefreshToken:false}});
   assert.equal((await customerClient.rpc('admin_queue_recovery',{p_booking:journal.bookingId,p_reason:'Ordinary customer must not authorize replacement'})).error?.code,'42501');
   assert.equal((await api(ct,'/api/admin/recovery',{bookingId:journal.bookingId})).status,403);
   const endpoint=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments`;
   assert.equal((await fetch(endpoint+'/recover',{method:'POST',headers:{Authorization:`Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,'Content-Type':'application/json'},body:'{}'})).status,401);
   assert.equal((await fetch(endpoint+'/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(events[0].payload)})).status,400);
   journal.checks.authorization='PASSED — actual customer database RPC 42501 / HTTP 403; publishable-only recovery 401; unsigned actual event body 400';save();
   // Diagnostic uses real unmodified network responses, never a provider stub.
   // It may only retry the already prepared generation-1 stable key.
   assert.equal(a.refund_generation,1);assert.equal(a.refund_retry_requested,false);assert.equal(refunds.data.length,1);
   assert.equal((await api(token,'/api/admin/actions',{operation:'recover',bookingId:journal.bookingId,reason:'Verify already prepared replacement; no new generation'})).status,200);
   const diagnostics:unknown[]=[];
   const realFetch:typeof fetch=async(input,init)=>{const response=await fetch(input,init);if(!response.ok){let problem:Record<string,unknown>={};try{problem=await response.clone().json();}catch{/* no raw response logging */}const error=(problem.error||problem) as Record<string,unknown>;writeFileSync('.tools/private/m3-retained-provider-rejection.json',JSON.stringify(problem),{mode:0o600});const field=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(v)?v:'withheld';let message=typeof error.message==='string'?error.message:'unavailable';for(const name of ['STRIPE_SECRET_KEY','SUPABASE_SECRET_KEY','SUPABASE_ACCESS_TOKEN','PALMSTEEZE_PAYMENT_WORKER_TOKEN','STRIPE_WEBHOOK_SECRET'])if(process.env[name])message=message.replaceAll(process.env[name]!, '[private value withheld]');message=message.replace(/https?:\/\/[^\s"'<>]+/g,'[URL withheld]').replace(/\b(?:sk|rk|pk|rkcs)_(?:test|live)_[A-Za-z0-9_.-]+/g,'[key withheld]').replace(/\b(?:pi|ch|re|cs|acct|req|evt|card|pm)_[A-Za-z0-9_]+/g,'[provider reference withheld]');diagnostics.push({provider:String(input).startsWith('https://api.stripe.com/')?'Stripe':'Supabase RPC',status:response.status,code:field(error.code),type:field(error.type),parameter:field(error.param),message});}return response;};
   const handler=paymentHandler({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey:process.env.SUPABASE_SECRET_KEY!,stripeKey:process.env.STRIPE_SECRET_KEY!,workerToken:process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN!,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET!,origin},realFetch);
   const response=await handler(new Request(endpoint+'/recover',{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:journal.bookingId})}));
   journal.checks.realNetworkDiagnostic={checkedAt:new Date().toISOString(),workerStatus:response.status,diagnostics};save();console.log(JSON.stringify(journal.checks.realNetworkDiagnostic));
   Object.assign(a,(await db.query('select * from public.payment_attempts where id=$1',[a.id])).rows[0]);
   if(response.status===200&&a.state==='review_required'&&diagnostics.length){assert.equal((await db.query('select 1 from private.payment_jobs where attempt_id=$1',[a.id])).rowCount,0);journal.phase='provider-blocked';save();}
  }
  if(command==='verify-blocked') {
   assert.equal(a.state,'review_required');assert.equal(a.refund_generation,1);assert.equal(a.refund_retry_requested,false);assert.equal(refunds.data.length,1);assert.equal(refunds.data[0].status,'failed');assert.equal(operations[1].refund_id,null);
   const token=await login(journal.admin!);assert.equal((await api(token,'/api/admin/recovery',{bookingId:journal.bookingId})).status,200);
   Object.assign(a,(await db.query('select * from public.payment_attempts where id=$1',[a.id])).rows[0]);assert.equal(a.state,'review_required');assert.equal(a.refund_generation,1);assert.equal(a.refund_retry_requested,false);assert.equal(a.refund_id,null);assert.equal(Number(a.refunded_kobo),0);
   assert.equal((await stripe.refunds.list({payment_intent:a.payment_intent_id})).data.length,1);assert.equal((await db.query('select 1 from private.payment_jobs where attempt_id=$1',[a.id])).rowCount,0);
   assert.deepEqual(operations.map(r=>r.generation),[0,1]);assert.equal(operations[0].state,'failed');assert.equal(operations[1].state,revised?'rejected':'requested');
   const audit=(await db.query("select action,created_at from public.admin_audit where target_id=$1 order by created_at",[journal.bookingId])).rows;assert.equal(audit.filter(r=>r.action==='failed_refund_retry_prepared').length,1);assert.ok(audit.filter(r=>r.action==='recovery_requested').length>=3);
   const tick=(await db.query("select d.start_time,d.end_time,d.status from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname='palmsteeze-payment-recovery' and d.start_time between $1::timestamptz-interval '10 seconds' and $1::timestamptz order by d.start_time desc limit 1",[operations[1].created_at])).rows[0];assert.equal(tick?.status,'succeeded');
   journal.checks.scheduledRecovery={status:'PASSED — existing operational minute job dispatch overlaps generation-1 preparation after controlled 90-second abandoned lease; no manual worker call before preparation',generationPreparedAt:operations[1].created_at,cronDispatch:tick,firstThreeRecoveryRequests:audit.filter(r=>r.action==='recovery_requested').slice(0,3).map(r=>r.created_at)};
   if(revised){assert.equal(a.refund_blocked,true);assert.equal(a.refund_state,'failed');assert.equal(a.refund_failure_reason,'provider_refused_refund');}
   journal.phase='provider-blocked';journal.checks.deployedPermanentRejection='PASSED — authenticated API reaches updated deployed worker; actual permanent Stripe rejection ends in review, no queued retry, no second provider refund or new generation';journal.checks.attemptHistory={status:'PASSED',generations:[0,1],firstState:'failed',replacementState:revised?'rejected — no provider refund ID':'requested — provider rejected creation; no refund ID',auditActions:audit};save();
  }
  if(command==='capture'){
   assert.equal(journal.phase,'provider-blocked');const browser=await chromium.launch({channel:'chrome'});mkdirSync('docs/screenshots',{recursive:true});
   try{for(const [name,viewport] of Object.entries({desktop:{width:1440,height:1000},mobile:{width:390,height:844}})){
    const context=await browser.newContext({viewport});await cookies(context,journal.admin!);const page=await context.newPage();await page.goto(origin+'/admin/recovery');const card=page.locator(`[data-payment-id="${a.id}"]`);await card.waitFor();assert.ok((await card.innerText()).includes('Payment: review_required'));assert.ok((await card.innerText()).includes('Refund operation 0: failed'));assert.ok((await card.innerText()).includes('Refund operation 1: requested'));
    await card.screenshot({path:`docs/screenshots/m3-actual-provider-rejection-${name}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await context.close();
   }}finally{await browser.close();}
   journal.checks.actualProviderScreens='PASSED — desktop/mobile actual admin recovery shows review_required, failed generation 0 and requested generation 1; no horizontal overflow';save();
  }
  if(command==='replace') {
   assert.equal(journal.phase,'waiting-first-failure');assert.equal(refunds.data.length,1);assert.equal(refunds.data[0].status,'failed');
   assert.ok(events.some(e=>e.state==='processed'&&e.processed_at));assert.equal(a.refund_state,'failed');assert.equal(a.state,'review_required');assert.equal(Number(a.refunded_kobo),0);
   const token=await login(journal.admin!);const customerToken=await login(journal.customer!);
   assert.equal((await api(customerToken,'/api/admin/recovery',{bookingId:journal.bookingId})).status,403);
   const customerClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${customerToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
   assert.equal((await customerClient.rpc('admin_queue_recovery',{p_booking:journal.bookingId,p_reason:'Ordinary customer must not authorize a replacement'})).error?.code,'42501');
   assert.equal((await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,'Content-Type':'application/json'},body:'{}'})).status,401);
   assert.equal((await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/webhook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(events[0].payload)})).status,400);
   const cancellation=(await db.query('select id from public.cancellation_requests where booking_id=$1',[journal.bookingId])).rows[0];
   assert.equal((await api(token,'/api/admin/actions',{operation:'decide',requestId:cancellation.id,approve:true,reason:'Repeat approval must not replace actual failed refund'})).status,200);
   assert.equal((await stripe.refunds.list({payment_intent:a.payment_intent_id})).data.length,1);
   // A controlled worker interruption before dispatch demonstrates durable
   // queue/lease recovery. It does not manufacture a refund or failure event.
   await db.query("insert into private.payment_jobs(attempt_id,lease_token,lease_until) values($1,$2,now()+interval '90 seconds') on conflict(attempt_id) do update set lease_token=$2,lease_until=now()+interval '90 seconds'",[a.id,randomUUID()]);
   const repeated=await Promise.all(Array.from({length:3},()=>api(token,'/api/admin/actions',{operation:'recover',bookingId:journal.bookingId,reason:'Explicit replacement after actual signed provider failure; duplicate safe queue'})));
   repeated.forEach(r=>assert.equal(r.status,200));assert.equal((await stripe.refunds.list({payment_intent:a.payment_intent_id})).data.length,1);
   journal.checks.authorization='PASSED — authenticated customer HTTP 403 / database RPC 42501; publishable-only privileged recovery 401; unsigned actual event body 400';
   journal.checks.concurrentRetry={status:'PASSED',requests:3,queuedAt:new Date().toISOString(),controlledAbandonedLease:(await db.query('select lease_until from private.payment_jobs where attempt_id=$1',[a.id])).rows[0].lease_until,refundsBeforeDispatch:1};
   journal.phase='waiting-replacement';save();
   // Let the existing operational minute job recover the abandoned lease.
   console.log('PASSED: real signed failed event processed; three actual-admin retry requests durable behind controlled abandoned lease. Existing minute schedule will perform replacement.');
  }
  if(journal.phase==='waiting-replacement'&&refunds.data.length===2){
   assert.deepEqual(operations.map(r=>r.generation),[0,1]);assert.equal(operations[0].state,'failed');assert.equal(refunds.data.find(r=>r.id===operations[0].refund_id)?.status,'failed');
   assert.ok(refunds.data.every(r=>r.amount===Number(a.collected_kobo)&&r.currency==='ngn'));
   assert.equal(refunds.data.find(r=>r.id===operations[1].refund_id)?.metadata?.palmsteeze_refund_generation,'1');
   journal.phase='waiting-second-failure';save();
   if(refunds.data.find(r=>r.id===operations[1].refund_id)?.status==='succeeded'&&a.refund_state==='succeeded'){
    const token=await login(journal.admin!);
    const repeats=await Promise.all([api(token,'/api/admin/recovery',{bookingId:journal.bookingId}),api(token,'/api/admin/recovery',{bookingId:journal.bookingId})]);repeats.forEach(r=>assert.equal(r.status,200));
    assert.equal((await stripe.refunds.list({payment_intent:a.payment_intent_id})).data.length,2);
    assert.equal((await db.query('select refund_generation,refund_retry_requested from public.payment_attempts where id=$1',[a.id])).rows[0].refund_generation,1);
    journal.checks.repeatedVerification='PASSED — two concurrent actual-admin recovery API requests; still exactly two refunds and generation 1';save();
   }
   console.log('PASSED: operational scheduled retry produced exactly one generation-1 replacement with preserved generation-0 failure and capped provider totals. Retaining until replacement delayed outcome.');
  }
  if(journal.phase==='waiting-second-failure'&&refunds.data.length===2&&refunds.data.every(r=>r.status==='failed')&&events.length===2&&events.every(e=>e.state==='processed')&&operations.length===2&&operations.every(r=>r.state==='failed')){
   assert.equal(a.refund_state,'failed');assert.equal(a.state,'review_required');assert.equal(Number(a.refunded_kobo),0);assert.equal(a.refund_retry_requested,false);assert.equal(a.refund_generation,1);
   journal.phase='proved';save();console.log('PASSED: both actual delayed failures signed, durably received and processed; one guarded replacement; complete two-generation history retained.');
   const receipts=(await db.query('select amount_kobo,state from public.payment_refund_receipts where attempt_id=$1',[a.id])).rows;assert.equal(receipts.length,2);assert.ok(receipts.every(r=>r.state==='failed'&&Number(r.amount_kobo)===Number(a.collected_kobo)));
   const token=await login(journal.admin!);const c=(await db.query('select id from public.cancellation_requests where booking_id=$1',[journal.bookingId])).rows[0];
   assert.equal((await api(token,'/api/admin/actions',{operation:'decide',requestId:c.id,approve:true,reason:'Repeat approval after two actual failures must not authorize third refund'})).status,200);assert.equal((await stripe.refunds.list({payment_intent:a.payment_intent_id})).data.length,2);
   assert.equal((await db.query("select count(*)::int n from public.admin_audit where target_id=$1 and action='failed_refund_retry_prepared'",[journal.bookingId])).rows[0].n,1);
   journal.checks.terminalHistory='PASSED — two actual failed provider receipts/ledger generations; exactly one replacement preparation; no third refund from repeated approval; zero successful refunds';save();
  }
  await checkPreservation(db);
  const observation={checkedAt:new Date().toISOString(),phase:journal.phase,providerRefunds:refunds.data.map(r=>({status:r.status,amountKobo:r.amount,generation:r.metadata?.palmsteeze_refund_generation||'0',createdAt:new Date(r.created*1000).toISOString()})),database:{state:a.state,refundState:a.refund_state,collectedKobo:Number(a.collected_kobo),refundedKobo:Number(a.refunded_kobo),operations:operations.map(r=>({generation:r.generation,state:r.state,amountKobo:Number(r.amount_kobo),createdAt:r.created_at,updatedAt:r.updated_at})),failureEvents:events.map(e=>({type:e.event_type,state:e.state,receivedAt:e.received_at,processedAt:e.processed_at,providerEventRetrieved:true}))},preexistingHistory:'PASSED',signedFailureIntegration:events.some(e=>e.state==='processed')?'PASSED':'NOT RUN — provider delay',replacement:operations.length===2&&refunds.data.length===2?'PASSED — one real provider replacement':'NOT RUN — no actual replacement returned',completion:journal.phase==='proved'?'PASSED':'NOT RUN — retained proof in progress'};
  journal.observations.push(observation);save();writeFileSync(evidencePath,JSON.stringify({startedAt:journal.startedAt,checks:journal.checks,observations:journal.observations,privateJournal:path,limits:'Natural provider events; no synthesized webhook or local failed-state mutation. Temporary lease interruption is explicitly controlled. Refund statuses can change later. Retained until actual delayed failure of replacement too.'},null,2)+'\n');
  if(command==='cleanup'||command==='archive-blocked'){
   if(command==='cleanup') {assert.equal(journal.phase,'proved','No successful cleanup before actual provider evidence');assert.ok(journal.checks.terminalHistory);}
   else {assert.equal(journal.phase,'provider-blocked');assert.ok(journal.checks.deployedPermanentRejection);assert.equal(refunds.data.length,1);assert.equal(refunds.data[0].status,'failed');assert.ok(events.some(e=>e.state==='processed'));assert.equal(a.state,'review_required');assert.equal(operations.length,2);assert.equal(operations[1].refund_id,null);if(revised)assert.match(JSON.parse(readFileSync('docs/evidence/m3-revised-acceptance.json','utf8')).status,/^PASSED/);}
   const history:Record<string,unknown>={providerRefunds:refunds.data,providerFailureEvents:await Promise.all(events.map(e=>stripe.events.retrieve(e.event_id))),baselineImmutableDigests:journal.baseline};
   for(const [table,query] of Object.entries({booking:'select * from public.bookings where id=$1',payment:'select * from public.payment_attempts where booking_id=$1',operations:'select * from public.refund_operations where attempt_id in(select id from public.payment_attempts where booking_id=$1) order by generation',receipts:'select * from public.payment_refund_receipts where attempt_id in(select id from public.payment_attempts where booking_id=$1)',events:'select * from private.payment_events where attempt_id in(select id from public.payment_attempts where booking_id=$1)',decisions:'select * from public.cancellation_requests where booking_id=$1',identities:'select * from private.cancellation_identity where request_id in(select id from public.cancellation_requests where booking_id=$1)',audit:'select * from public.admin_audit where target_id=$1 order by created_at'})) history[table]=(await db.query(query,[journal.bookingId])).rows;
   writeFileSync(restored?'.tools/private/m3-restored-refund-history.json':revised?'.tools/private/m3-revised-refund-history.json':'.tools/private/m3-retained-refund-history.json',JSON.stringify(history,null,2)+'\n',{mode:0o600});
   const ids=[journal.customer!.id,journal.admin!.id];
   await db.query('begin');try{
    await db.query('delete from public.admin_audit where actor_id=any($1::uuid[]) or target_id=$2',[ids,journal.bookingId]);
    await db.query('delete from private.payment_events where attempt_id=$1',[a.id]);await db.query('delete from private.payment_jobs where attempt_id=$1',[a.id]);
    await db.query('delete from public.refund_operations where attempt_id=$1',[a.id]);await db.query('delete from public.payment_attempts where id=$1 and owner_id=$2',[a.id,journal.customer!.id]);
    await db.query('delete from public.cancellation_requests where booking_id=$1 and owner_id=$2',[journal.bookingId,journal.customer!.id]);await db.query('delete from public.allocations where booking_id=$1',[journal.bookingId]);
    await db.query('delete from public.bookings where id=$1 and owner_id=$2',[journal.bookingId,journal.customer!.id]);await db.query('delete from private.app_roles where user_id=$1',[journal.admin!.id]);await checkPreservation(db);await db.query('commit');
   }catch(error){await db.query('rollback');throw error;}
   for(const id of ids)assert.equal((await auth.auth.admin.deleteUser(id)).error,null);
   journal.phase=command==='cleanup'?'cleaned':'blocked-archived';save();
   writeFileSync(evidencePath,JSON.stringify({startedAt:journal.startedAt,checks:journal.checks,observations:journal.observations,cleanup:'PASSED — only journal-owned booking/Auth fixtures removed after evidence; actual sandbox provider history retained; complete private history exported before cleanup',preexistingHistory:'PASSED',completion:command==='cleanup'?'PASSED':revised?'FAILED — provider replacement creation; revised safe exception acceptance separately PASSED':'FAILED — actual provider refuses replacement after failed card refund; M3 replacement proof stays open'},null,2)+'\n');
   console.log('PASSED: collected evidence retained; only proof-owned database/Auth fixtures removed; all preexisting financial and manual histories preserved.');
  }else console.log(JSON.stringify(observation));
 }finally{await db.end();}
}
main().catch(error=>{mkdirSync('.tools/private',{recursive:true});writeFileSync('.tools/private/m3-retained-refund-error.txt',error instanceof Error ? error.stack||error.message:'Diagnostic unavailable',{mode:0o600});safeFailure(error);});
