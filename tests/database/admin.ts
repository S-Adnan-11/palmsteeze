import {writeEvidence} from '../../scripts/lib/evidence';
import {fixtureCheckout} from './reservation-fixtures';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure } from '../../scripts/lib/database';
import { initialBookingDate,intervalFromSelection } from '../../src/lib/domain';
import type { Client } from 'pg';
type User={id:string;api:SupabaseClient};
async function main() {
 await verifyProject();const db=await connectDatabase();const peers:Client[]=[];const users:User[]=[];const closureIDs:string[]=[];
 const evidence:Record<string,unknown>={checkedAt:new Date().toISOString(),paymentFixture:'Controlled SQL paid-state fixture, not provider-payment evidence. Real sandbox payment/refund proof is in the browser suite.'};
 const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const interval=intervalFromSelection(initialBookingDate(new Date(Date.now()+20*86400000)),18,1);let count=0;
 const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();evidence[name]='PASSED';count++;console.log(`PASSED: ${name}`);}catch(error){evidence[name]='FAILED';mkdirSync('.tools/private',{recursive:true});writeFileSync('.tools/private/m3-database-failure.txt',error instanceof Error ? error.stack||error.message:'Unknown error');throw error;}};
 async function role(peer:Client,user:User|null,query:string,args:unknown[]=[],rollback=false) {
  await peer.query('begin');try {await peer.query(user ? 'set local role authenticated':'set local role anon');await peer.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(user ? {sub:user.id,role:'authenticated'}:{role:'anon'})]);
   assert.equal((await peer.query('select current_user as role')).rows[0].role,user ? 'authenticated':'anon');const result=await peer.query(query,args);await peer.query(rollback ? 'rollback':'commit');return result;
  }catch(error){await peer.query('rollback');throw error;}
 }
 try {
  await inspectDatabase(db);const baseline=JSON.parse(readFileSync('docs/evidence/m2b-inspection.json','utf8')) as {checkedAt:string;legacyBookings:{total:number}};
  const originals=(await db.query('select id,to_jsonb(b) as record from public.bookings b where created_at<=$1::timestamptz order by id',[baseline.checkedAt])).rows;assert.equal(originals.length,baseline.legacyBookings.total);
  for(let i=0;i<3;i++) {const email=`m3-db-${randomUUID()}@palmsteeze.invalid`;const password=randomBytes(32).toString('base64url');const created=await auth.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin'}});assert.ok(created.data.user);
   const api=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});users.push({id:created.data.user.id,api});assert.ok((await api.auth.signInWithPassword({email,password})).data.session);assert.equal((await api.auth.getUser()).data.user?.id,users[i].id);
  }
  await db.query("insert into private.app_roles(user_id,role) values($1,'admin'),($2,'admin')",[users[1].id,users[2].id]);peers.push(await connectDatabase(),await connectDatabase());
  assert.notEqual((await peers[0].query('select pg_backend_pid() as id')).rows[0].id,(await peers[1].query('select pg_backend_pid() as id')).rows[0].id);
  const resource=(await db.query("select * from public.resources where code='OPEN-12'")).rows[0];
  await check('actual anonymous customer admin roles and immutable audit boundaries',async()=>{
   const rpcCalls=[['admin_snapshot',{}],['admin_update_resource',{p_resource:resource.id,p_name:'Forbidden',p_description:'Forbidden',p_active:false,p_reason:'fixture'}],['admin_schedule_rate',{p_resource:resource.id,p_effective:new Date(Date.now()+3600000).toISOString(),p_hourly:1,p_reason:'fixture'}],['admin_update_hours',{p_open:9,p_close:10,p_reason:'fixture'}],['admin_remove_closure',{p_closure:randomUUID(),p_reason:'fixture'}],['admin_queue_recovery',{p_booking:randomUUID(),p_reason:'fixture'}],['admin_decide_cancellation',{p_request:randomUUID(),p_approve:true,p_reason:'fixture'}],['prepare_refund_operation',{p_attempt:randomUUID(),p_lease:randomUUID(),p_failed:null}]] as const;
   const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
   for(const api of [anon,users[0].api]) for(const [rpc,args] of rpcCalls) assert.equal((await api.rpc(rpc,args)).error?.code,'42501');
   for(const user of [null,users[0]]) await assert.rejects(role(peers[0],user,'select public.admin_snapshot()'),(e:unknown)=>(e as {code?:string}).code==='42501');
   assert.equal((await users[0].api.from('admin_audit').select('id')).data?.length,0);assert.ok((await users[1].api.rpc('admin_snapshot')).data);
   for(const user of users) for(const table of ['admin_audit','refund_operations','resources','resource_rates']) assert.equal((await user.api.from(table).insert({})).error?.code,'42501');
  });
  const quote=(await users[0].api.rpc('quote_resource',{p_resource:resource.id,p_start:interval.starts_at,p_end:interval.ends_at})).data;
  const expected=Object.fromEntries(['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'].map(k=>[k,quote[k]]));
  const created=await fixtureCheckout(users[0].api,{p_resource:resource.id,p_start:interval.starts_at,p_end:interval.ends_at,p_request:randomUUID(),p_expected:expected});assert.equal(created.error,null);const booking=created.data.booking;const attempt=created.data.payment;
  await db.query('begin');await db.query("update public.bookings set state='confirmed' where id=$1",[booking.id]);await db.query("update public.payment_attempts set state='paid',payment_intent_id=$2 where id=$1",[attempt.id,`pi_fixture${randomUUID().replaceAll('-','')}`]);await db.query("update private.payment_jobs set lease_token=$2,lease_until=now()+interval '10 minutes' where attempt_id=$1",[attempt.id,randomUUID()]);await db.query('commit');
  const cancellation=(await users[0].api.rpc('request_cancellation',{p_booking:booking.id,p_reason:'Isolated database fixture request'})).data;
  await check('closures resource archives and reduced hours report affected booking without cancellation',async()=>{
   for(const [rpc,args] of [
    ['admin_create_closure',{p_resource:resource.id,p_start:interval.starts_at,p_end:interval.ends_at,p_reason:'fixture conflict',p_request:randomUUID()}],
    ['admin_update_resource',{p_resource:resource.id,p_name:resource.name,p_description:resource.description,p_active:false,p_reason:'fixture archive conflict'}],
    ['admin_update_hours',{p_open:8,p_close:18,p_reason:'fixture hours conflict'}],
   ] as const) {const result=await users[1].api.rpc(rpc,args);assert.equal(result.error?.code,'23P01');assert.ok(JSON.parse(result.error!.details!).some((r:{bookingId:string})=>r.bookingId===booking.id));}
   assert.equal((await db.query('select state from public.bookings where id=$1',[booking.id])).rows[0].state,'confirmed');
   assert.equal((await db.query('select active from public.allocations where booking_id=$1',[booking.id])).rows[0].active,true);
   await role(peers[0],users[1],'select public.admin_create_closure($1,$2,$3,$4,$5)',[resource.id,interval.ends_at,new Date(Date.parse(interval.ends_at)+3600000).toISOString(),'Rollback-scoped adjacent active booking',randomUUID()],true);
  });
  await check('concurrent repeated approval queues exactly one full refund operation',async()=>{
   const results=await Promise.all(peers.map((peer,i)=>role(peer,users[i+1],'select public.admin_decide_cancellation($1,true,$2) as booking',[cancellation.id,'Concurrent isolated approval'])));
   assert.equal(results[0].rows[0].booking,booking.id);assert.equal(results[1].rows[0].booking,booking.id);
   assert.equal((await db.query('select count(*)::int as n from public.refund_operations where attempt_id=$1',[attempt.id])).rows[0].n,1);
   assert.equal((await db.query("select count(*)::int as n from public.admin_audit where target_id=$1 and action='cancellation_approved'",[booking.id])).rows[0].n,1);
   assert.equal((await db.query('select state from public.bookings where id=$1',[booking.id])).rows[0].state,'cancelled');assert.equal((await db.query('select active from public.allocations where booking_id=$1',[booking.id])).rows[0].active,false);
   assert.equal((await users[0].api.rpc('admin_decide_cancellation',{p_request:cancellation.id,p_approve:false,p_reason:'forged decision'})).error?.code,'42501');
   assert.equal((await users[1].api.rpc('admin_decide_cancellation',{p_request:cancellation.id,p_approve:false,p_reason:'cannot reverse decision'})).error?.code,'22023');
  });
  await check('future rates preserve all booking snapshots and invalid admin work rolls back',async()=>{
   const before=(await db.query('select policy_snapshot,total_kobo,deposit_kobo,deposit_percent from public.bookings where id=$1',[booking.id])).rows[0];
   await role(peers[0],users[1],'select public.admin_schedule_rate($1,$2,$3,$4)',[resource.id,new Date(Date.now()+3600000).toISOString(),280000,'Rollback-scoped future rate'],true);
   assert.deepEqual((await db.query('select policy_snapshot,total_kobo,deposit_kobo,deposit_percent from public.bookings where id=$1',[booking.id])).rows[0],before);
   assert.equal((await users[1].api.rpc('admin_schedule_rate',{p_resource:resource.id,p_effective:new Date(Date.now()-1000).toISOString(),p_hourly:1,p_reason:'past rate'})).error?.code,'22023');
   assert.equal((await users[1].api.rpc('admin_update_resource',{p_resource:resource.id,p_name:'',p_description:'bad',p_active:true,p_reason:'bad'})).error?.code,'22023');
   assert.equal((await db.query('select deposit_percent from public.venue_settings')).rows[0].deposit_percent,40);
  });
  await check('adjacent closure succeeds and retry/removal are idempotent with history',async()=>{
   const start=new Date(Date.parse(interval.ends_at)).toISOString();const end=new Date(Date.parse(start)+3600000).toISOString();const args={p_resource:resource.id,p_start:start,p_end:end,p_reason:'Isolated adjacent closure',p_request:randomUUID()};
   const first=await users[1].api.rpc('admin_create_closure',args);assert.equal(first.error,null);closureIDs.push(first.data);const second=await users[1].api.rpc('admin_create_closure',args);assert.equal(second.data,first.data);
   assert.equal((await db.query("select count(*)::int as n from public.admin_audit where target_id=$1 and action='closure_created'",[first.data])).rows[0].n,1);
   for(let i=0;i<2;i++) assert.equal((await users[1].api.rpc('admin_remove_closure',{p_closure:first.data,p_reason:'Isolated removal'})).error,null);
   assert.equal((await db.query('select active from public.allocations where id=$1',[first.data])).rows[0].active,false);
   assert.equal((await db.query("select count(*)::int as n from public.admin_audit where target_id=$1 and action='closure_removed'",[first.data])).rows[0].n,1);
  });
  await check('original customers bookings snapshots and inventory preserved',async()=>{
   const after=(await db.query('select id,to_jsonb(b) as record from public.bookings b where id=any($1::uuid[]) order by id',[originals.map(r=>r.id)])).rows;assert.deepEqual(after,originals);
   assert.equal((await db.query('select count(*)::int as n,sum(seats)::int as seats from public.resources')).rows[0].n,27);assert.equal((await db.query('select sum(seats)::int as seats from public.resources')).rows[0].seats,44);
  });
  evidence.groups=count;
 } finally {
  const ids=users.map(u=>u.id);await db.query('begin');
  await db.query('delete from public.admin_audit where actor_id=any($1::uuid[]) or target_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);
  await db.query('delete from public.allocations where kind=\'closure\' and id=any($1::uuid[])',[closureIDs]);
  await db.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
  await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
  await db.query('delete from private.payment_jobs where attempt_id in(select id from public.payment_attempts where owner_id=any($1::uuid[]))',[ids]);
  await db.query('delete from public.payment_attempts where owner_id=any($1::uuid[])',[ids]);await db.query('delete from public.cancellation_requests where owner_id=any($1::uuid[])',[ids]);
  await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);await db.query('delete from public.bookings where owner_id=any($1::uuid[])',[ids]);await db.query('delete from private.app_roles where user_id=any($1::uuid[])',[ids]);await db.query('commit');
  for(const u of users) assert.equal((await auth.auth.admin.deleteUser(u.id)).error,null);for(const peer of peers) await peer.end();await db.end();
  mkdirSync('docs/evidence',{recursive:true});writeEvidence('m3-database.json',evidence);
 }
}
main().catch(safeFailure);
