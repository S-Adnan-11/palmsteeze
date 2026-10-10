import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import type {Client} from 'pg';
import {verifyProject,connectDatabase,safeFailure} from '../../scripts/lib/database';
import {reservationCapability,type ReservationIntent} from '../../src/lib/reservation-capability';
import {createClearance,signSecurityPayload} from '../../src/lib/security-sessions';
import {initialBookingDate,intervalFromSelection} from '../../src/lib/domain';
async function main(){
 await verifyProject();const db=await connectDatabase(),peers:Client[]=[],users:string[]=[];
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const results:Record<string,unknown>[]=[];
 async function role(peer:Client,user:string|null,sql:string,args:unknown[]=[],service=false){
  await peer.query('begin');try{const r=service?'service_role':user?'authenticated':'anon';await peer.query(`set local role ${r}`);await peer.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:r,...(user?{sub:user}:{})})]);assert.equal((await peer.query('select current_user r')).rows[0].r,r);const out=await peer.query(sql,args);await peer.query('commit');return out;}catch(e){await peer.query('rollback');throw e;}
 }
 try {
  for(let i=0;i<3;i++){const password=randomBytes(32).toString('base64url');const email=`entrance-${randomUUID()}@palmsteeze.invalid`;const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(made.data.user);users.push(made.data.user.id);const api=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});assert.ok((await api.auth.signInWithPassword({email,password})).data.session);assert.equal((await api.auth.getUser()).data.user?.id,users[i]);}
  await db.query("insert into private.app_roles(user_id,role) values($1,'admin')",[users[2]]);peers.push(await connectDatabase(),await connectDatabase());
  assert.notEqual((await peers[0].query('select pg_backend_pid() p')).rows[0].p,(await peers[1].query('select pg_backend_pid() p')).rows[0].p);
  const resource=(await db.query("select id from public.resources where code='OPEN-14'")).rows[0].id;
  const interval=intervalFromSelection(initialBookingDate(new Date(Date.now()+17*86400000)),10,1);
  const base:ReservationIntent={userId:users[0],operation:'hold',resourceId:resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID(),amountKobo:null,expectedQuote:null};
  const args=[resource,interval.starts_at,interval.ends_at,base.requestId];
  const counts=async()=> (await db.query('select (select count(*) from public.bookings where owner_id=any($1::uuid[]))::int bookings,(select count(*) from public.payment_attempts where owner_id=any($1::uuid[]))::int payments,(select count(*) from private.reservation_authorizations where user_id=any($1::uuid[]))::int grants',[users])).rows[0];
  async function denied(name:unknown,fn:()=>Promise<unknown>,code='42501'){const before=await counts();await assert.rejects(fn(),(e:unknown)=>(e as {code:string}).code===code);assert.deepEqual(await counts(),before);results.push({name,denied:true,noSideEffects:true});}
  for(const [label,user,service] of [['anon',null,false],['customer',users[0],false],['assigned-admin',users[2],false],['service',null,true]] as const){
   for(const [name,sql,values] of [['hold','select public.create_hold($1,$2,$3,$4)',args],['checkout-five','select public.begin_checkout($1,$2,$3,$4,$5)',[...args,{}]],['checkout-six','select public.begin_checkout($1,$2,$3,$4,$5,$6)',[...args,{},null]]] as const)await denied(`${label} original ${name}`,()=>role(peers[0],user,sql,[...values],service));
  }
  const holdSql='select public.create_verified_hold($1,$2,$3,$4,$5) booking';
  const grant=reservationCapability(base,process.env);
  for(const [name,cap] of [['missing',null],['forged',grant+'a'],['clearance-not-grant',createClearance(process.env)],['expired',reservationCapability(base,process.env,Date.now()-61000)],['wrong-user',reservationCapability({...base,userId:users[1]},process.env)],['wrong-operation',reservationCapability({...base,operation:'checkout'},process.env)],['wrong-resource',reservationCapability({...base,resourceId:randomUUID()},process.env)],['wrong-interval',reservationCapability({...base,endsAt:new Date(Date.parse(base.endsAt)+3600000).toISOString()},process.env)],['wrong-request',reservationCapability({...base,requestId:randomUUID()},process.env)],['wrong-amount',reservationCapability({...base,amountKobo:1},process.env)],['wrong-quote',reservationCapability({...base,expectedQuote:{}},process.env)]])await denied(name,()=>role(peers[0],users[0],holdSql,[...args,cap]));
  for(const user of [null,users[1],users[2]])await denied('role/owner cannot reuse customer capability',()=>role(peers[0],user,holdSql,[...args,grant]));
  await denied('service cannot invoke guarded customer entry',()=>role(peers[0],null,holdSql,[...args,grant],true));
  for(const table of ['private.reservation_security_config','private.reservation_authorizations'])for(const user of [null,users[0],users[2]])await denied('private configuration/nonce inaccessible',()=>role(peers[0],user,`select * from ${table}`));
  const racing=await Promise.allSettled(peers.map(peer=>role(peer,users[0],holdSql,[...args,grant])));console.log(JSON.stringify({race:racing.map(r=>r.status==='fulfilled'?'accepted':(r.reason as {code:string}).code)}));assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);assert.equal(racing.filter(r=>r.status==='rejected'&&(r.reason as {code:string}).code==='42501').length,1);
  const booking=(racing.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof role>>>).value.rows[0].booking;
  await denied('consumed replay',()=>role(peers[0],users[0],holdSql,[...args,grant]));
  const retries=await Promise.all(peers.map(peer=>role(peer,users[0],holdSql,[...args,reservationCapability(base,process.env)])));assert.ok(retries.every(r=>r.rows[0].booking.id===booking.id));assert.equal((await counts()).bookings,1);
  await role(peers[0],users[0],'select public.release_hold($1)',[booking.id]);
  results.push({name:'single capability race and fresh-capability idempotent retries',oneBooking:true,atomicSingleConsumption:true,independentConnections:2});
  const quote=(await role(peers[0],users[0],'select public.quote_resource($1,$2,$3) q',[resource,base.startsAt,base.endsAt])).rows[0].q;
  const expected=Object.fromEntries(['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'].map(k=>[k,quote[k]]));
  const checkout={...base,operation:'checkout' as const,requestId:randomUUID(),amountKobo:100001,expectedQuote:expected};
  const checkoutSql='select public.begin_verified_checkout($1,$2,$3,$4,$5,$6,$7) result';
  const checkoutArgs=[resource,base.startsAt,base.endsAt,checkout.requestId,expected,100001];
  await denied('checkout amount mismatch',()=>role(peers[0],users[0],checkoutSql,[...checkoutArgs,reservationCapability({...checkout,amountKobo:quote.total_kobo},process.env)]));
  await denied('checkout quote mismatch',()=>role(peers[0],users[0],checkoutSql,[...checkoutArgs,reservationCapability({...checkout,expectedQuote:{}},process.env)]));
  const invalid={...checkout,requestId:randomUUID(),expectedQuote:{...expected,total_kobo:1}};const invalidCap=reservationCapability(invalid,process.env);
  await denied('authoritative quote failure rolls back grant and reservation',()=>role(peers[0],users[0],checkoutSql,[resource,base.startsAt,base.endsAt,invalid.requestId,invalid.expectedQuote,100001,invalidCap]),'P0001');
  const accepted=await Promise.all(peers.map(peer=>role(peer,users[0],checkoutSql,[...checkoutArgs,reservationCapability(checkout,process.env)])));assert.equal(accepted[0].rows[0].result.booking.id,accepted[1].rows[0].result.booking.id);assert.equal(accepted[0].rows[0].result.payment.id,accepted[1].rows[0].result.payment.id);assert.equal(accepted[0].rows[0].result.payment.amount_kobo,100001);
  const jobs=(await db.query('select count(*)::int n from private.payment_jobs where attempt_id=$1',[accepted[0].rows[0].result.payment.id])).rows[0].n;assert.equal(jobs,1);
  // No worker/provider call: remove only this unleased fixture job before cleanup.
  const job=(await db.query('select lease_token from private.payment_jobs where attempt_id=$1',[accepted[0].rows[0].result.payment.id])).rows[0];assert.equal(job.lease_token,null);
  results.push({name:'concurrent checkout',oneBooking:true,oneAttempt:true,oneJob:true,amountKobo:100001,provider:'not invoked'});
  // Assigned administrators remain authenticated customers for their own grant.
  const own={...base,userId:users[2],requestId:randomUUID(),startsAt:new Date(Date.parse(base.startsAt)+7200000).toISOString(),endsAt:new Date(Date.parse(base.endsAt)+7200000).toISOString()};
  const made=await role(peers[0],users[2],holdSql,[resource,own.startsAt,own.endsAt,own.requestId,reservationCapability(own,process.env)]);assert.equal(made.rows[0].booking.owner_id,users[2]);
  // Signed malformed expiry cannot pass even with trusted test issuer.
  const payload=JSON.parse(Buffer.from(grant.split('.')[0],'base64url').toString());payload.exp=payload.iat+61;payload.nonce=randomUUID();await denied('signed lifetime mismatch',()=>role(peers[0],users[0],holdSql,[...args,signSecurityPayload('reservation',payload,process.env)]));
  writeFileSync(process.env.PALMSTEEZE_SECURITY_EVIDENCE||'docs/evidence/m4-entrance/database-security.json',JSON.stringify({kind:'actual-role-dedicated-PostgreSQL; trusted test-issued capabilities, no Siteverify substitution claim',checks:results.length,results},null,2));console.log(`PASSED: ${results.length} reservation boundary checks; actual roles and independent concurrent connections.`);
 } finally {
  try{if(users.length){const unsafe=(await db.query('select count(*)::int n from public.payment_attempts where owner_id=any($1::uuid[]) and (collected_kobo<>0 or session_id is not null)',[users])).rows[0].n;assert.equal(unsafe,0);await db.query('begin');await db.query('delete from public.payment_attempts where owner_id=any($1::uuid[])',[users]);await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=any($1::uuid[]))',[users]);await db.query('delete from public.bookings where owner_id=any($1::uuid[])',[users]);await db.query('delete from private.app_roles where user_id=any($1::uuid[])',[users]);await db.query('commit');for(const id of users)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);}}finally{await Promise.all(peers.map(p=>p.end()));await db.end();}
 }
}
main().catch(error=>{const line=String(error?.stack).match(/entrance-security\.ts:\d+:\d+/)?.[0];if(line)console.error(`Proof location: ${line}; values withheld.`);safeFailure(error);});
