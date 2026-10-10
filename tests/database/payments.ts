import {fixtureCheckout,fixtureReservationQuery} from './reservation-fixtures';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'pg';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure,ReadinessError } from '../../scripts/lib/database';
import { verifiedStripeSandbox } from '../../scripts/lib/stripe-sandbox';
import { paymentHandler,type PaymentConfig } from '../../supabase/functions/palmsteeze-payments/index';
import { initialBookingDate,intervalFromSelection } from '../../src/lib/domain';
type Identity={id:string;token:string;api:SupabaseClient};
async function main() {
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();const peers:Client[]=[];
 const identities:Identity[]=[];const run=randomUUID();const evidence:Record<string,unknown>={checkedAt:new Date().toISOString()};
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const endpoint=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`;
 const config:PaymentConfig={supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey:process.env.SUPABASE_SECRET_KEY!,
  stripeKey:process.env.STRIPE_SECRET_KEY!,workerToken:process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN!,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET!,origin:'http://localhost:3000'};
 const request=(bookingId?:string)=>new Request(endpoint,{method:'POST',headers:{Authorization:`Bearer ${config.workerToken}`,'Content-Type':'application/json'},body:JSON.stringify(bookingId ? {bookingId}:{})});
 const diagnosticFetch:typeof fetch=async(input,init)=>{
  const response=await fetch(input,init);
  if(!response.ok) {
   const url=new URL(String(input));const operation=url.pathname.includes('/rpc/') ? url.pathname.split('/rpc/')[1]:'stripe-api';
   console.error(JSON.stringify({operation,status:response.status}));mkdirSync('.tools/private',{recursive:true});
   writeFileSync('.tools/private/payment-http-error.json',await response.clone().text(),{mode:0o600});
  }return response;
 };
 const local=paymentHandler(config,diagnosticFetch);
 const invoke=async(id:string,handler=local)=>handler(request(id));
 let groups=0;
 const check=async(name:string,fn:()=>Promise<void>)=>{
  try {await fn();groups++;evidence[name]='PASSED';console.log(`PASSED: ${name}`);}
  catch(error) {
   evidence[name]='FAILED';mkdirSync('.tools/private',{recursive:true});
   writeFileSync('.tools/private/payment-test-failure.txt',error instanceof Error ? error.stack||error.message:'Unknown failure',{mode:0o600});
   const e=error as {actual?:unknown;expected?:unknown;code?:string};
   console.error(`FAILED: ${name}; private diagnostic saved.`);
   if(typeof e.actual==='number'&&typeof e.expected==='number') console.error(JSON.stringify({actual:e.actual,expected:e.expected}));
   throw error;
  }
 };
 async function role<T>(client:Client,user:Identity|null,fn:()=>Promise<T>,rollback=false) {
  await client.query('begin');try {
   await client.query(user ? 'set local role authenticated':'set local role anon');
   await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(user ? {sub:user.id,role:'authenticated'}:{role:'anon'})]);
   assert.equal((await client.query('select current_user as role')).rows[0].role,user ? 'authenticated':'anon');
   const value=await fn();await client.query(rollback ? 'rollback':'commit');return value;
  } catch(error){await client.query('rollback');throw error;}
 }
 const date=initialBookingDate(new Date(Date.now()+12*86400000));const interval=intervalFromSelection(date,10,1);
 const expected=async(resource:string)=>{
  const {rows}=await db.query('select public.quote_resource($1,$2,$3) as quote',[resource,interval.starts_at,interval.ends_at]);const q=rows[0].quote;
  return {hourly_kobo:q.hourly_kobo,total_kobo:q.total_kobo,deposit_percent:q.deposit_percent,deposit_kobo:q.deposit_kobo,balance_kobo:q.balance_kobo};
 };
 let attemptID='';let bookingID='';let sessionID='';
 try {
  await inspectDatabase(db);
  const originalIDs=(await db.query('select id from public.bookings order by id')).rows.map(r=>r.id);
  const preserved=()=>db.query("select count(*)::int as n,md5(coalesce(string_agg((to_jsonb(b)-'state'-'payment_kind')::text,'' order by id),'')) as hash from public.bookings b where id=any($1::uuid[])",[originalIDs]);
  const before=(await preserved()).rows[0];
  for(let i=0;i<3;i++) {
   const email=`m2-${run}-${i}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');
   const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin'}});
   if(created.error||!created.data.user) throw new ReadinessError('Auth fixture creation failed; details withheld.');
   const api=createClient(config.supabaseURL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
   const user:Identity={id:created.data.user.id,token:'',api};identities.push(user);
   const signed=await api.auth.signInWithPassword({email,password});assert.ok(signed.data.session);user.token=signed.data.session.access_token;
   const verified=await api.auth.getUser();assert.equal(verified.data.user?.id,user.id);
  }
  await db.query("insert into private.app_roles(user_id,role) values($1,'admin')",[identities[2].id]);
  peers.push(await connectDatabase(),await connectDatabase());
  const pids=await Promise.all(peers.map(async c=>(await c.query('select pg_backend_pid() as pid')).rows[0].pid));assert.notEqual(pids[0],pids[1]);
  const resources=(await db.query("select id,code from public.resources where code in ('OPEN-08','OPEN-09','OPEN-10')")).rows;
  const ids=Object.fromEntries(resources.map(r=>[r.code,r.id]));
  await check('actual anonymous customer and assigned-admin boundaries',async()=>{
   for(const user of [null,identities[0],identities[2]]) for(const query of [
    'select public.claim_payment_work(null,2)',"select public.receive_payment_event('evt_proof',$1,'checkout.session.expired','{}')",
    'select * from private.payment_jobs','select * from private.payment_events',
   ]) await assert.rejects(role(peers[0],user,()=>peers[0].query(query,query.includes('$1') ? [randomUUID()]:[])),(e:unknown)=>(e as {code?:string}).code==='42501');
   for(const user of [identities[0],identities[2]]) assert.equal((await user.api.rpc('claim_payment_work',{p_booking:null,p_limit:2})).error?.code,'42501');
   const anon=createClient(config.supabaseURL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
   assert.equal((await anon.rpc('claim_payment_work',{p_booking:null,p_limit:2})).error?.code,'42501');
   const unauthorized:Record<string,string>[]=[{},{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!},{Authorization:'Bearer invalid'}];
   for(const headers of unauthorized) {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});assert.equal(response.status,401);
   }
  });
  await check('atomic checkout race one winner under independent customer connections',async()=>{
   const q=await expected(ids['OPEN-09']);let waiting=0;let release:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;});
   const results=await Promise.allSettled(peers.map((peer,i)=>role(peer,identities[i],async()=>{
    if(++waiting===2) release();await barrier;
    const value=await fixtureReservationQuery(peer,'select public.begin_checkout($1,$2,$3,$4,$5) as detail',[ids['OPEN-09'],interval.starts_at,interval.ends_at,randomUUID(),q]);
    await peer.query('select pg_sleep(0.25)');return value.rows[0].detail;
   })));
   const winners=results.filter(r=>r.status==='fulfilled');assert.equal(winners.length,1);
   const loser=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(loser.reason.code,'23P01');
   const winner=(winners[0] as PromiseFulfilledResult<{booking:{id:string;owner_id:string};payment:{id:string}}>).value;
   const user=identities.find(u=>u.id===winner.booking.owner_id)!;
   assert.equal((await user.api.rpc('request_checkout_cancel',{p_booking:winner.booking.id})).error,null);
   assert.equal((await invoke(winner.booking.id)).status,200);
   assert.equal((await db.query('select state from public.bookings where id=$1',[winner.booking.id])).rows[0].state,'released');
  });
  await check('changed reviewed quote rolls back allocation payment and job',async()=>{
   const requestID=randomUUID();const q=await expected(ids['OPEN-10']);
   const result=await fixtureCheckout(identities[0].api,{p_resource:ids['OPEN-10'],p_start:interval.starts_at,p_end:interval.ends_at,p_request:requestID,p_expected:{...q,deposit_kobo:1}});
   assert.equal(result.error?.code,'P0001');assert.equal((await db.query('select count(*)::int as n from public.bookings where request_id=$1',[requestID])).rows[0].n,0);
  });
  await check('real Stripe response loss retains inventory and retries one idempotent Session',async()=>{
   const q=await expected(ids['OPEN-08']);const requestID=randomUUID();const args={p_resource:ids['OPEN-08'],p_start:interval.starts_at,p_end:interval.ends_at,p_request:requestID,p_expected:q};
   const start=await fixtureCheckout(identities[0].api,args);assert.equal(start.error,null);
   bookingID=start.data.booking.id;attemptID=start.data.payment.id;assert.equal(start.data.payment.amount_kobo,80000);
   const again=await fixtureCheckout(identities[0].api,args);assert.equal(again.data.booking.id,bookingID);assert.equal(again.data.payment.id,attemptID);
   const losingResponse:typeof fetch=async(input,init)=>{
    const response=await fetch(input,init);
    if(String(input)==='https://api.stripe.com/v1/checkout/sessions' && init?.method==='POST' && response.ok) {
     const created=await response.clone().json();sessionID=created.id;
     throw new Error('Controlled lost response after real provider success');
    } return response;
   };
   assert.equal((await invoke(bookingID,paymentHandler(config,losingResponse))).status,503);assert.ok(sessionID);
   const pending=(await db.query('select state,session_id from public.payment_attempts where id=$1',[attemptID])).rows[0];assert.equal(pending.state,'creating');assert.equal(pending.session_id,null);
   await db.query("update public.bookings set expires_at=now()-interval '1 minute' where id=$1",[bookingID]);
   const availability=await identities[1].api.rpc('resource_availability',{p_start:interval.starts_at,p_end:interval.ends_at});
   assert.equal(availability.data.find((r:{resource_id:string})=>r.resource_id===ids['OPEN-08']).available,false);
   await assert.rejects(role(peers[0],identities[1],()=>peers[0].query('select public.release_hold($1)',[bookingID])),(e:unknown)=>(e as {code?:string}).code==='42501');
   assert.equal((await invoke(bookingID)).status,200);
   const stored=(await db.query('select state,session_id from public.payment_attempts where id=$1',[attemptID])).rows[0];assert.equal(stored.state,'open');assert.equal(stored.session_id,sessionID);
   const sessions=await stripe.checkout.sessions.list({limit:100});assert.equal(sessions.data.filter(s=>s.metadata?.palmsteeze_payment_id===attemptID).length,1);
  });
  await check('customer isolation prevents price state ownership and recovery writes',async()=>{
   assert.equal((await identities[1].api.from('payment_attempts').select('*').eq('id',attemptID)).data?.length,0);
   assert.equal((await identities[1].api.from('bookings').select('*').eq('id',bookingID)).data?.length,0);
   for(const change of [{state:'paid'},{amount_kobo:1},{owner_id:identities[1].id},{refund_state:'succeeded'}]) {
    assert.equal((await identities[0].api.from('payment_attempts').update(change).eq('id',attemptID)).error?.code,'42501');
   }
   assert.equal((await identities[0].api.rpc('is_admin')).data,false);assert.equal((await identities[2].api.rpc('is_admin')).data,true);
   assert.equal((await identities[0].api.rpc('release_hold',{p_booking:bookingID})).error?.code,'22023');
  });
  await check('controlled provider outage defers durable work without releasing uncertain inventory',async()=>{
   const outage:typeof fetch=async(input,init)=>{if(String(input).startsWith('https://api.stripe.com/')) throw new Error('Controlled provider outage');return fetch(input,init);};
   assert.equal((await invoke(bookingID,paymentHandler(config,outage))).status,503);
   const job=(await db.query('select last_error,lease_token,next_attempt_at>now() as deferred from private.payment_jobs where attempt_id=$1',[attemptID])).rows[0];
   assert.equal(job.last_error,'provider_unavailable');assert.equal(job.lease_token,null);assert.equal(job.deferred,true);
   assert.equal((await db.query('select active from public.allocations where booking_id=$1',[bookingID])).rows[0].active,true);
   assert.equal((await invoke(bookingID)).status,200);
  });
  await check('definitive first-dispatch rejection releases only known unpaid setup',async()=>{
   const result=await fixtureCheckout(identities[1].api,{p_resource:ids['OPEN-10'],p_start:interval.starts_at,p_end:interval.ends_at,p_request:randomUUID(),p_expected:await expected(ids['OPEN-10'])});
   assert.equal(result.error,null);const id=result.data.booking.id;
   const rejected:typeof fetch=async(input,init)=>String(input)==='https://api.stripe.com/v1/checkout/sessions'&&init?.method==='POST'
    ? Response.json({error:{type:'invalid_request_error',param:'allowed_payment_method_types'}},{status:400}):fetch(input,init);
   assert.equal((await invoke(id,paymentHandler(config,rejected))).status,200);
   const row=(await db.query('select b.state,a.active,p.state as payment,p.session_id from public.bookings b join public.allocations a on a.booking_id=b.id join public.payment_attempts p on p.booking_id=b.id where b.id=$1',[id])).rows[0];
   assert.deepEqual(row,{state:'expired',active:false,payment:'creation_failed',session_id:null});
  });
  await check('expired idempotency window stops new Sessions and retains uncertain allocation',async()=>{
   const result=await fixtureCheckout(identities[1].api,{p_resource:ids['OPEN-10'],p_start:interval.starts_at,p_end:interval.ends_at,p_request:randomUUID(),p_expected:await expected(ids['OPEN-10'])});
   assert.equal(result.error,null);const id=result.data.booking.id;
   await db.query("update public.payment_attempts set created_at=now()-interval '25 hours' where booking_id=$1",[id]);
   let providerCalls=0;const observed:typeof fetch=async(input,init)=>{if(String(input).startsWith('https://api.stripe.com/')) providerCalls++;return fetch(input,init);};
   assert.equal((await invoke(id,paymentHandler(config,observed))).status,200);assert.equal(providerCalls,0);
   assert.equal((await db.query('select state from public.payment_attempts where booking_id=$1',[id])).rows[0].state,'review_required');
   assert.equal((await db.query('select active from public.allocations where booking_id=$1',[id])).rows[0].active,true);
  });
  await check('verified Stripe expiration safely releases cancellation and natural signed event is durable',async()=>{
   assert.equal((await identities[0].api.rpc('request_checkout_cancel',{p_booking:bookingID})).error,null);
   assert.equal((await invoke(bookingID)).status,200);
   const session=await stripe.checkout.sessions.retrieve(sessionID);assert.equal(session.status,'expired');assert.equal(session.payment_status,'unpaid');
   const row=(await db.query('select b.state,a.active,p.state as payment from public.bookings b join public.allocations a on a.booking_id=b.id join public.payment_attempts p on p.booking_id=b.id where b.id=$1',[bookingID])).rows[0];
   assert.deepEqual(row,{state:'released',active:false,payment:'expired'});
   for(let i=0;i<30;i++) {if((await db.query('select count(*)::int as n from private.payment_events where attempt_id=$1',[attemptID])).rows[0].n>0) break;await new Promise(r=>setTimeout(r,1000));}
   assert.ok((await db.query('select count(*)::int as n from private.payment_events where attempt_id=$1',[attemptID])).rows[0].n>0);
   assert.equal((await invoke(bookingID)).status,200);
   const events=await stripe.events.list({type:'checkout.session.expired',limit:100});
   const event=events.data.find(e=>(e.data.object as {metadata?:Record<string,string>}).metadata?.palmsteeze_payment_id===attemptID);assert.ok(event);
   const payload=JSON.stringify(event);const signature=stripe.webhooks.generateTestHeaderString({payload,secret:config.webhookSecret});
   const webhook=endpoint.replace('/recover','/webhook');
   for(let i=0;i<2;i++) assert.equal((await fetch(webhook,{method:'POST',headers:{'Stripe-Signature':signature,'Content-Type':'application/json'},body:payload})).status,200);
   assert.equal((await db.query('select count(*)::int as n from private.payment_events where event_id=$1',[event.id])).rows[0].n,1);
   assert.equal((await fetch(webhook,{method:'POST',headers:{'Stripe-Signature':'t=1,v1=invalid'},body:payload})).status,400);
  });
  await check('original customer ownership inventory and immutable snapshots preserved',async()=>{
   const after=(await preserved()).rows[0];
   assert.deepEqual(after,before);
  });
  evidence.groups=groups;evidence.faultInjection='Lost provider response and outage deliberately injected; Session/idempotency/expiration/natural webhook are actual Stripe sandbox evidence.';
 } finally {
  const userIDs=identities.map(u=>u.id);
  // Cleanup is restricted to this run's genuine fixtures; no existing account or
  // booking is included. Verify provider outcomes before deleting local fixtures.
  const attempts=(await db.query('select id,session_id from public.payment_attempts where owner_id=any($1::uuid[])',[userIDs])).rows;
  const sessions=await stripe.checkout.sessions.list({limit:100});
  for(const session of sessions.data.filter(s=>attempts.some(a=>a.id===s.metadata?.palmsteeze_payment_id))) {
   if(session.status==='open'&&session.payment_status==='unpaid') await stripe.checkout.sessions.expire(session.id);
   assert.notEqual(session.payment_status,'paid','Unexpected paid backend fixture retained; verify/refund it privately before cleanup.');
  }
  await db.query('begin');
  await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[userIDs]);
  await db.query('delete from private.payment_jobs where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[userIDs]);
 await db.query('delete from public.admin_audit where actor_id=any($1::uuid[]) or target_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[userIDs]);
 await db.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[userIDs]);
  await db.query('delete from public.payment_attempts where owner_id=any($1::uuid[])',[userIDs]);
  await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[userIDs]);
  await db.query('delete from public.bookings where owner_id=any($1::uuid[])',[userIDs]);
  await db.query('delete from private.app_roles where user_id=any($1::uuid[])',[userIDs]);await db.query('commit');
  for(const user of identities) assert.equal((await admin.auth.admin.deleteUser(user.id)).error,null);
  for(const peer of peers) await peer.end();await db.end();
  mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m2-payment-database.json',JSON.stringify(evidence,null,2)+'\n');
 }
}
main().catch(safeFailure);
