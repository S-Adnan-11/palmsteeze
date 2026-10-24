import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {chromium} from '@playwright/test';
import {verifyProject,connectDatabase,safeFailure} from './lib/database';
import {verifiedStripeSandbox} from './lib/stripe-sandbox';
import {paymentHandler} from '../supabase/functions/palmsteeze-payments/index';
const origin='http://localhost:3000';
async function main(){
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();const second=await connectDatabase();
 const restored=process.argv.includes('restored');
 const j=JSON.parse(readFileSync(restored?'.tools/private/m3-restored-refund-proof.json':'.tools/private/m3-revised-refund-proof.json','utf8'));
 const evidence:Record<string,unknown>={checkedAt:new Date().toISOString(),acceptanceChange:'Owner explicitly approved durable detected failure, permanent retry stop, preserved history and actionable assistance when Stripe refuses replacement. Original replacement creation remains FAILED.',originalEvidence:'docs/evidence/m3-retained-refund-proof.json'};
 evidence.fixtureSource=restored?'Explicit restoration of exact old proof-owned database rows and legitimate Auth UUIDs from private archive; actual provider failure re-retrieved and signed original event resent. No owner rows changed or local failure synthesized.':'New natural delayed provider failure';
 try{
  const snapshot=async()=>(await db.query('select * from public.payment_attempts where id=$1',[j.attemptId])).rows[0];const a=await snapshot();
  assert.equal(a.refund_blocked,true);assert.equal(a.refund_state,'failed');assert.equal(a.state,'review_required');assert.equal(a.refund_retry_requested,false);assert.equal(a.refund_failure_reason,'provider_refused_refund');assert.ok(a.refund_blocked_at);assert.equal(Number(a.refunded_kobo),0);
  const b=(await db.query('select * from public.bookings where id=$1',[j.bookingId])).rows[0];assert.equal(b.state,'cancelled');assert.equal((await db.query('select active from public.allocations where booking_id=$1',[b.id])).rows[0].active,false);
  const refunds=await stripe.refunds.list({payment_intent:a.payment_intent_id,limit:100});assert.equal(refunds.has_more,false);assert.equal(refunds.data.length,1);assert.equal(refunds.data[0].status,'failed');
  const operations=(await db.query('select * from public.refund_operations where attempt_id=$1 order by generation',[a.id])).rows;assert.deepEqual(operations.map(r=>r.state),['failed','rejected']);assert.deepEqual(operations.map(r=>r.generation),[0,1]);assert.equal(operations[0].refund_id,refunds.data[0].id);assert.equal(operations[1].refund_id,null);
  const events=(await db.query("select * from private.payment_events where attempt_id=$1 and event_type='refund.failed'",[a.id])).rows;assert.equal(events.length,1);assert.equal(events[0].state,'processed');const actual=await stripe.events.retrieve(events[0].event_id);assert.equal(actual.type,'refund.failed');assert.equal(actual.data.object.id,refunds.data[0].id);
  async function login(role:'admin'|'customer'){
   const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});const u=j[role];const result=await client.auth.signInWithPassword({email:u.email,password:u.password});assert.equal(result.error,null);assert.equal((await client.auth.getUser()).data.user?.id,u.id);return {client,token:result.data.session!.access_token};
  }
  const admin=await login('admin');const customer=await login('customer');
  async function post(token:string,url:string,data:unknown){return fetch(origin+url,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(data)});}
  assert.equal((await customer.client.rpc('admin_queue_recovery',{p_booking:b.id,p_reason:'Unauthorized permanent rejection retry'})).error?.code,'42501');
  assert.equal((await customer.client.rpc('stop_rejected_refund',{p_attempt:a.id,p_lease:randomUUID()})).error?.code,'42501');
  assert.equal((await admin.client.from('payment_attempts').update({refund_blocked:false}).eq('id',a.id)).error?.code,'42501');
  const decision=(await db.query('select id from public.cancellation_requests where booking_id=$1',[b.id])).rows[0];
  const results=await Promise.all([...Array.from({length:4},()=>post(admin.token,'/api/admin/actions',{operation:'recover',bookingId:b.id,reason:'Repeated blocked action must not reopen permanently rejected work'})),post(admin.token,'/api/admin/actions',{operation:'decide',requestId:decision.id,approve:true,reason:'Repeated approval preserves rejected refund'}),post(admin.token,'/api/admin/recovery',{bookingId:b.id})]);results.forEach(r=>assert.equal(r.status,200));
  assert.equal((await db.query('select 1 from private.payment_jobs where attempt_id=$1',[a.id])).rowCount,0);
  assert.equal((await second.query('select refund_blocked from public.payment_attempts where id=$1',[a.id])).rows[0].refund_blocked,true);
  evidence.rolesAndRepeatedActions='PASSED — actual customer RPC denied, admin direct flag edits denied; concurrent authenticated administration cannot requeue or create a new generation; independent connection sees durable rejection';
  // Actual provider resend, not a fabricated signed failure. Key travels only
  // through the private child environment; CLI output stays Git-ignored.
  const platform=JSON.parse(readFileSync('.tools/private/payment-platform.json','utf8'));const cfg='.tools/private/refund-proof-cli.toml';if(!existsSync(cfg))writeFileSync(cfg,'');
  for(let i=0;i<2;i++){
   const cli:{status:number|null;stdout:string;stderr:string}=spawnSync(process.execPath,['node_modules/@stripe/cli/bin/shim.js','events','resend',actual.id,'--webhook-endpoint',platform.endpointID,'--config',cfg,'--log-level','error'],{windowsHide:true,encoding:'utf8',timeout:45000,env:{...process.env,STRIPE_API_KEY:process.env.STRIPE_SECRET_KEY,STRIPE_CLI_TELEMETRY_OPTOUT:'1'}});
   writeFileSync(`.tools/private/m3-revised-resend-${i}.log`,(cli.stdout||'')+(cli.stderr||''),{mode:0o600});assert.equal(cli.status,0,'Actual provider resend failed; details retained privately');
  }
  await new Promise(resolve=>setTimeout(resolve,4000));assert.equal((await db.query("select count(*)::int n from private.payment_events where attempt_id=$1 and event_type='refund.failed'",[a.id])).rows[0].n,1);assert.equal((await db.query('select 1 from private.payment_jobs where attempt_id=$1',[a.id])).rowCount,0);
  evidence.actualSignedDuplicateResends='PASSED — Stripe CLI resent the original actual failure twice; one durable event and no reopened job';
  // Controlled stale queue injection is a restart fault, NOT provider evidence.
  await second.query('insert into private.payment_jobs(attempt_id) values($1)',[a.id]);let stripeRequests=0;
  const handler=paymentHandler({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey:process.env.SUPABASE_SECRET_KEY!,stripeKey:process.env.STRIPE_SECRET_KEY!,workerToken:process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN!,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET!,origin},async(input,init)=>{if(String(input).startsWith('https://api.stripe.com/'))stripeRequests++;return fetch(input,init);});
  const endpoint=process.env.NEXT_PUBLIC_SUPABASE_URL+'/functions/v1/palmsteeze-payments/recover';const headers={Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'};
  assert.equal((await handler(new Request(endpoint,{method:'POST',headers,body:JSON.stringify({bookingId:b.id})}))).status,200);assert.equal(stripeRequests,0);assert.equal((await db.query('select 1 from private.payment_jobs where attempt_id=$1',[a.id])).rowCount,0);
  await second.query('insert into private.payment_jobs(attempt_id) values($1)',[a.id]);assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({bookingId:b.id})})).status,200);assert.equal((await db.query('select 1 from private.payment_jobs where attempt_id=$1',[a.id])).rowCount,0);
  evidence.recoveryRestart='PASSED — controlled stale-job injection through an independent connection; actual PostgreSQL claim suppresses blocked work, restarted local and deployed workers cannot contact Stripe/create a refund';
  const browser=await chromium.launch({channel:'chrome'});mkdirSync('.tools/private/screenshots',{recursive:true});
  try{for(const [name,viewport]of Object.entries({desktop:{width:1440,height:1000},mobile:{width:390,height:844}}))for(const role of ['customer','admin']as const){
   const context=await browser.newContext({viewport});const jar=new Map<string,string>();const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});assert.ok((await client.auth.signInWithPassword({email:j[role].email,password:j[role].password})).data.session);await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
   const page=await context.newPage();await page.goto(origin+(role==='admin'?'/admin/bookings/':'/booking/')+b.id);const text=await page.locator('main').innerText();
   if(role==='customer'){assert.match(text,/Refund: failed — assistance required/);assert.match(text,/Refund failed/);assert.match(text,/still needs to be reimbursed/);assert.equal(await page.getByTestId('booking-state').innerText(),'Booking: cancelled');assert.equal(await page.getByTestId('refund-state').innerText(),'Refund: failed — assistance required');}
   else{assert.match(text,/Outstanding reimbursement:\s*.*800/);assert.match(text,/Failure reason: Stripe permanently refused/);assert.match(text,/Complete booking audit/);assert.match(text,/refund permanently rejected/);assert.match(text,new RegExp(refunds.data[0].id));assert.equal(await page.getByRole('button',{name:'Retry provider verification'}).count(),0);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`.tools/private/screenshots/m3-revised-${role}-${name}.png`,fullPage:true});await context.close();
  }}finally{await browser.close();}
  evidence.customerAndAdminScreens='PASSED — actual legitimate Auth/browser desktop and mobile; cancellation separate, failed/assistance wording, unresolved amount, reason, references and complete audit; private captures, no portfolio identity exposure';
  const final=await snapshot();assert.equal(final.refund_blocked,true);assert.equal(final.refund_generation,1);assert.equal(Number(final.refunded_kobo),0);assert.equal((await stripe.refunds.list({payment_intent:a.payment_intent_id})).data.length,1);assert.equal((await db.query('select count(*)::int n from public.refund_operations where attempt_id=$1',[a.id])).rows[0].n,2);
  const before=JSON.parse(readFileSync('docs/evidence/m3-retained-refund-proof.json','utf8'));assert.match(before.completion,/FAILED/);
  evidence.originalReplacementCreation='FAILED — preserved unchanged';evidence.newReplacementCreation='FAILED — actual provider permanently refused';evidence.externalReimbursement='NOT RUN — outside sandbox transfer capability; obligation remains unresolved';evidence.status='PASSED — permanent rejection safely recorded; reimbursement remains outstanding';evidence.originalEvidenceSha256=createHash('sha256').update(readFileSync('docs/evidence/m3-retained-refund-proof.json')).digest('hex');
  writeFileSync('docs/evidence/m3-revised-acceptance.json',JSON.stringify(evidence,null,2)+'\n');console.log('PASSED: revised M3 criteria verified with actual failure/rejection, genuine roles, actual signed duplicate resends, restart protection and customer/admin browser checks. Original replacement result remains FAILED.');
 }finally{await second.end();await db.end();}
}
main().catch(error=>{writeFileSync('.tools/private/m3-revised-acceptance-error.txt',error instanceof Error?error.stack||error.message:'Details unavailable',{mode:0o600});safeFailure(error);});
