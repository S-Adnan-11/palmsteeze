import {fixtureCheckout} from './reservation-fixtures';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Client} from 'pg';
import {verifyProject,connectDatabase,inspectDatabase,safeFailure} from '../../scripts/lib/database';
import {initialBookingDate,intervalFromSelection} from '../../src/lib/domain';
type User={id:string;api:SupabaseClient;email:string};
async function main(){
 await verifyProject();const db=await connectDatabase();const peers:Client[]=[];const users:User[]=[];
 const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const evidence:Record<string,unknown>={checkedAt:new Date().toISOString(),paymentBasis:'Isolated controlled SQL collected/refund snapshots; actual provider proof is separately in the browser suite.'};let groups=0;
 const check=async(name:string,fn:()=>Promise<void>)=>{await fn();groups++;evidence[name]='PASSED';console.log(`PASSED: ${name}`);};
 async function role(peer:Client,actor:User|'service'|null,sql:string,args:unknown[]=[],rollback=false){
  await peer.query('begin');try{const name=actor==='service'?'service_role':actor?'authenticated':'anon';await peer.query(`set local role ${name}`);await peer.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(actor==='service'?{role:name}:actor?{sub:actor.id,role:name}:{role:name})]);assert.equal((await peer.query('select current_user as r')).rows[0].r,name);const result=await peer.query(sql,args);await peer.query(rollback?'rollback':'commit');return result;}catch(e){await peer.query('rollback');throw e;}
 }
 const owned:{booking:string;attempt:string;lease:string}[]=[];
 try{
  await inspectDatabase(db);const baseline=(await db.query('select id,owner_id,total_kobo,deposit_kobo,balance_kobo,deposit_percent,policy_snapshot from public.bookings order by id')).rows;
  for(let i=0;i<3;i++){const email=`m3-options-${randomUUID()}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');const made=await auth.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:i===1?'Original administrator':'Original customer',role:'admin'}});assert.ok(made.data.user);
   const api=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});assert.ok((await api.auth.signInWithPassword({email,password})).data.session);assert.equal((await api.auth.getUser()).data.user?.id,made.data.user.id);users.push({id:made.data.user.id,api,email});
  }
  await db.query("insert into private.app_roles(user_id,role) values($1,'admin')",[users[1].id]);peers.push(await connectDatabase(),await connectDatabase());assert.notEqual((await peers[0].query('select pg_backend_pid() as n')).rows[0].n,(await peers[1].query('select pg_backend_pid() as n')).rows[0].n);
  const resource=(await db.query("select id from public.resources where code='OPEN-13'")).rows[0].id;const date=initialBookingDate(new Date(Date.now()+22*86400000));
  const interval=intervalFromSelection(date,10,1);const quote=(await users[0].api.rpc('quote_resource',{p_resource:resource,p_start:interval.starts_at,p_end:interval.ends_at})).data;
  const expected=Object.fromEntries(['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'].map(k=>[k,quote[k]]));
  await check('server money bounds reject below above fractional and forged quote with rollback',async()=>{
   const before=(await db.query('select count(*)::int as n from public.bookings where owner_id=$1',[users[0].id])).rows[0].n;
   for(const amount of [quote.deposit_kobo-1,quote.total_kobo+1,-1,80000.1]){const result=await fixtureCheckout(users[0].api,{p_resource:resource,p_start:interval.starts_at,p_end:interval.ends_at,p_request:randomUUID(),p_expected:expected,p_amount:amount});assert.ok(result.error);}
   const result=await fixtureCheckout(users[0].api,{p_resource:resource,p_start:interval.starts_at,p_end:interval.ends_at,p_request:randomUUID(),p_expected:{...expected,total_kobo:1},p_amount:quote.total_kobo});assert.equal(result.error?.code,'P0001');assert.equal((await db.query('select count(*)::int as n from public.bookings where owner_id=$1',[users[0].id])).rows[0].n,before);
  });
  await check('minimum higher fractional-naira and full choices preserve minimum snapshots and idempotency',async()=>{
   for(const [i,amount] of [quote.deposit_kobo,100001,quote.total_kobo].entries()){
    const time=intervalFromSelection(date,10+i*2,1);const request=randomUUID();const args={p_resource:resource,p_start:time.starts_at,p_end:time.ends_at,p_request:request,p_expected:expected,p_amount:amount};const made=await fixtureCheckout(users[0].api,args);assert.equal(made.error,null);assert.equal(made.data.payment.amount_kobo,amount);assert.equal(made.data.booking.deposit_kobo,quote.deposit_kobo);assert.equal(made.data.booking.balance_kobo,quote.balance_kobo);assert.equal(made.data.booking.deposit_percent,40);
    assert.equal((await fixtureCheckout(users[0].api,args)).data.payment.id,made.data.payment.id);assert.equal((await fixtureCheckout(users[0].api,{...args,p_amount:amount===quote.total_kobo?amount-1:amount+1})).error?.code,'22023');
    const lease=randomUUID();owned.push({booking:made.data.booking.id,attempt:made.data.payment.id,lease});await db.query('begin');await db.query("update public.bookings set state='confirmed' where id=$1",[made.data.booking.id]);await db.query("update public.payment_attempts set state='paid',collected_kobo=amount_kobo,payment_intent_id=$2 where id=$1",[made.data.payment.id,`pi_fixture${randomUUID().replaceAll('-','')}`]);await db.query("update private.payment_jobs set lease_token=$2,lease_until=now()+interval '10 minutes' where attempt_id=$1",[made.data.payment.id,lease]);await db.query('commit');
   }
  });
  let first:string;let pending:string;
  await check('request and decision identities freeze independently of later profile changes',async()=>{
   const requested=await users[0].api.rpc('request_cancellation',{p_booking:owned[1].booking,p_reason:'First isolated request'});assert.equal(requested.error,null);first=requested.data.id;
   assert.equal((await users[1].api.rpc('admin_decide_cancellation',{p_request:first,p_approve:false,p_reason:'Original isolated rejection'})).error,null);
   const before=(await db.query('select * from private.cancellation_identity where request_id=$1',[first])).rows[0];assert.equal(before.customer.name,'Original customer');assert.equal(before.customer.email,users[0].email);assert.equal(before.administrator.name,'Original administrator');assert.equal(before.administrator.user_id,users[1].id);assert.ok(before.decision_at);
   for(const [i,u] of users.entries()) assert.equal((await auth.auth.admin.updateUserById(u.id,{email:`m3-options-changed-${randomUUID()}@palmsteeze.invalid`,email_confirm:true,user_metadata:{full_name:i?'Changed administrator':'Changed customer'}})).error,null);
   assert.deepEqual((await db.query('select * from private.cancellation_identity where request_id=$1',[first])).rows[0],before);assert.equal((await users[1].api.rpc('admin_decide_cancellation',{p_request:first,p_approve:false,p_reason:'Repeated decision must not overwrite attribution'})).error,null);
   const audit=(await db.query("select actor_snapshot from public.admin_audit where target_id=$1 and action='cancellation_rejected'",[owned[1].booking])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_snapshot.name,'Original administrator');assert.equal(audit[0].actor_snapshot.email,users[1].email);
  });
  await check('concurrent repeat request after rejection retains all decisions and exactly one pending',async()=>{
   const result=await Promise.all(peers.map((p,i)=>role(p,users[0],'select public.request_cancellation($1,$2) as c',[owned[1].booking,`New reason ${i}`])));assert.equal(result[0].rows[0].c.id,result[1].rows[0].c.id);pending=result[0].rows[0].c.id;
   const history=(await db.query('select id,state,reason from public.cancellation_requests where booking_id=$1 order by created_at',[owned[1].booking])).rows;assert.equal(history.length,2);assert.equal(history[0].id,first);assert.equal(history[0].state,'rejected');assert.equal(history[1].state,'pending');assert.equal((await users[0].api.rpc('request_cancellation',{p_booking:owned[1].booking,p_reason:' '})).error?.code,'22023');
   await Promise.all(peers.map(p=>role(p,users[1],'select public.admin_decide_cancellation($1,true,$2)',[pending,'Concurrent re-request approval'])));assert.equal((await db.query('select count(*)::int as n from public.refund_operations where attempt_id=$1',[owned[1].attempt])).rows[0].n,1);
   const money=(await db.query("select changes from public.admin_audit where target_id=$1 and action='cancellation_approved'",[owned[1].booking])).rows[0].changes;assert.equal(money.minimum_deposit_kobo,80000);assert.equal(money.collected_payment_kobo,100001);assert.equal(Object.hasOwn(money,'deposit_kobo'),false);
  });
  await check('private identities admin RPCs refund receipts and authoritative money reject customer writes',async()=>{
   for(const actor of [null,...users]) await assert.rejects(role(peers[0],actor,'select * from private.cancellation_identity'),(e:unknown)=>(e as {code?:string}).code==='42501');
   assert.equal((await users[0].api.rpc('admin_snapshot')).error?.code,'42501');const snap=(await users[1].api.rpc('admin_booking_snapshot',{p_booking:owned[1].booking})).data;assert.equal(snap.cancellations.find((c:{id:string})=>c.id===first).administrator_identity.email,users[1].email);
   const safe=(await users[0].api.from('cancellation_requests').select('id,state,reason,decision_reason,decided_at').eq('booking_id',owned[1].booking)).data!;assert.equal(Object.hasOwn(safe[0],'administrator_identity'),false);assert.equal(Object.hasOwn(safe[0],'customer_identity'),false);
   assert.equal((await users[0].api.from('cancellation_requests').select('decided_by').eq('booking_id',owned[1].booking)).error?.code,'42501');
   const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
   for(const api of [anon,...users.map(u=>u.api)]) assert.equal((await api.rpc('record_refund_snapshot',{p_attempt:owned[2].attempt,p_lease:owned[2].lease,p_collected:200000,p_refunds:[]})).error?.code,'42501');
   for(const u of users){assert.equal((await u.api.from('payment_refund_receipts').insert({})).error?.code,'42501');assert.equal((await u.api.from('payment_attempts').update({collected_kobo:1}).eq('id',owned[2].attempt)).error?.code,'42501');}
  });
  await check('remaining refund bounded by collected amount and prior refunds with duplicate reconciliation',async()=>{
   const b=owned[2];const c=(await users[0].api.rpc('request_cancellation',{p_booking:b.booking,p_reason:'Full payment prior-partial controlled fixture'})).data;assert.equal((await users[1].api.rpc('admin_decide_cancellation',{p_request:c.id,p_approve:true,p_reason:'Refund remaining collected amount'})).error,null);
   const pi=(await db.query('select payment_intent_id from public.payment_attempts where id=$1',[b.attempt])).rows[0].payment_intent_id;
   await role(peers[0],'service','select public.prepare_refund_operation($1,$2,null)',[b.attempt,b.lease]);
   const prior={id:`re_fixture${randomUUID().replaceAll('-','')}`,amount:20000,currency:'ngn',payment_intent:pi,status:'succeeded',metadata:{}};
   const waiting=(await role(peers[0],'service','select public.record_refund_snapshot($1,$2,$3,$4) as a',[b.attempt,b.lease,200000,JSON.stringify([{...prior,status:'pending'}])])).rows[0].a;
   assert.equal(waiting.pending_refund_kobo,20000);assert.equal(waiting.refund_state,'pending');assert.equal((await db.query('select prepared_at from public.refund_operations where attempt_id=$1',[b.attempt])).rows[0].prepared_at,null);
   const snapshot=()=>role(peers[0],'service','select public.record_refund_snapshot($1,$2,$3,$4) as a',[b.attempt,b.lease,200000,JSON.stringify([prior])]);
   assert.equal((await snapshot()).rows[0].a.refund_amount_kobo,180000);assert.equal((await snapshot()).rows[0].a.refunded_kobo,20000);
   await assert.rejects(role(peers[0],'service','select public.record_refund_snapshot($1,$2,$3,$4)',[b.attempt,b.lease,200000,JSON.stringify([prior,{...prior,id:`re_fixture${randomUUID().replaceAll('-','')}`,amount:190000}])]),(e:unknown)=>(e as {code?:string}).code==='22023');
   const refund={...prior,id:`re_fixture${randomUUID().replaceAll('-','')}`,amount:180000,metadata:{palmsteeze_payment_id:b.attempt,palmsteeze_refund_generation:'0'}};
   const all=[prior,refund];for(let i=0;i<2;i++) assert.equal((await role(peers[0],'service','select public.record_refund_snapshot($1,$2,$3,$4) as a',[b.attempt,b.lease,200000,JSON.stringify(all)])).rows[0].a.refunded_kobo,200000);
   const result={result:'refunded',amount:200000,currency:'ngn',environment:'sandbox',refund_id:refund.id,collected_amount:200000,refund_amount:180000,refunded_amount:199999};
   await assert.rejects(role(peers[0],'service','select public.finish_payment_work($1,$2,$3)',[b.attempt,b.lease,result]),(e:unknown)=>(e as {code?:string}).code==='22023');result.refunded_amount=200000;
   await role(peers[0],'service','select public.finish_payment_work($1,$2,$3)',[b.attempt,b.lease,result]);const final=(await db.query('select * from public.payment_attempts where id=$1',[b.attempt])).rows[0];assert.equal(final.refund_state,'succeeded');assert.equal(Number(final.refunded_kobo),Number(final.collected_kobo));assert.equal(final.amount_kobo,'200000');
   assert.equal((await db.query('select count(*)::int as n from public.refund_operations where attempt_id=$1',[b.attempt])).rows[0].n,1);
   assert.equal((await users[2].api.from('payment_refund_receipts').select('refund_id').eq('attempt_id',b.attempt)).data?.length,0);
   assert.equal((await users[0].api.from('payment_refund_receipts').select('refund_id').eq('attempt_id',b.attempt)).data?.length,2);
  });
  await check('all preexisting customer financial snapshots preserved',async()=>{assert.deepEqual((await db.query('select id,owner_id,total_kobo,deposit_kobo,balance_kobo,deposit_percent,policy_snapshot from public.bookings where id=any($1::uuid[]) order by id',[baseline.map(b=>b.id)])).rows,baseline);});
  evidence.groups=groups;
 }catch(e){evidence.failure='FAILED';mkdirSync('.tools/private',{recursive:true});writeFileSync('.tools/private/payment-options-failure.txt',e instanceof Error?e.stack||e.message:'Unknown');throw e;}
 finally{const ids=users.map(u=>u.id);await db.query('begin');await db.query('delete from public.admin_audit where actor_id=any($1::uuid[]) or target_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from private.payment_jobs where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from public.payment_attempts where owner_id=any($1::uuid[])',[ids]);await db.query('delete from public.cancellation_requests where owner_id=any($1::uuid[])',[ids]);await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from public.bookings where owner_id=any($1::uuid[])',[ids]);await db.query('delete from private.app_roles where user_id=any($1::uuid[])',[ids]);await db.query('commit');for(const u of users) assert.equal((await auth.auth.admin.deleteUser(u.id)).error,null);for(const p of peers) await p.end();await db.end();mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m3-payment-options-database.json',JSON.stringify(evidence,null,2)+'\n');}
}
main().catch(safeFailure);
