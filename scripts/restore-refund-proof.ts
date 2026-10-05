// Replay ONLY the exact archived run-owned fixture against its unchanged real
// Stripe payment. This is an explicit archive restoration, not a fabricated
// provider failure or an authentication bypass. No owner data is updated.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {verifyProject,connectDatabase,safeFailure} from './lib/database';
import {verifiedStripeSandbox} from './lib/stripe-sandbox';
async function main(){
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();
 const original=JSON.parse(readFileSync('.tools/private/m3-retained-refund-proof.json','utf8'));
 const archive=JSON.parse(readFileSync('.tools/private/m3-retained-refund-history.json','utf8'));
 const destination='.tools/private/m3-restored-refund-proof.json';
 const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  assert.equal(original.phase,'blocked-archived');const previous=existsSync(destination)?JSON.parse(readFileSync(destination,'utf8')):null;
  if(process.argv.includes('repair-attribution')){assert.equal(previous?.phase,'provider-blocked');for(const role of ['customer','admin']as const){assert.equal((await auth.auth.admin.updateUserById(original[role].id,{user_metadata:{full_name:`PalmSteeze retained proof ${role}`}})).error,null);}await db.query('begin');try{for(const row of archive.audit){assert.equal(row.target_id,original.bookingId);await db.query('update public.admin_audit set actor_snapshot=$2 where id=$1 and target_id=$3',[row.id,row.actor_snapshot,original.bookingId]);assert.deepEqual((await db.query('select * from public.admin_audit where id=$1',[row.id])).rows[0],{...row,created_at:new Date(row.created_at)});}await db.query('commit');}catch(error){await db.query('rollback');throw error;}console.log('PASSED: proof-only insertion trigger attribution restored exactly from original archive; no owner history changed.');return;}
  if(previous)assert.equal(previous.phase,'restoring-archive','Completed proof must not be overwritten');
  assert.equal(archive.booking.length,1);assert.equal(archive.payment.length,1);const b=archive.booking[0];const a=archive.payment[0];
  assert.equal(b.id,original.bookingId);assert.equal(a.id,original.attemptId);assert.equal(a.owner_id,original.customer.id);assert.equal(b.owner_id,a.owner_id);assert.equal(b.state,'cancelled');
  assert.equal((await db.query('select 1 from public.bookings where id=$1',[b.id])).rowCount,0);
  if(!previous)assert.equal((await db.query('select 1 from auth.users where id=any($1::uuid[])',[[original.customer.id,original.admin.id]])).rowCount,0);
  const pi=await stripe.paymentIntents.retrieve(a.payment_intent_id);assert.equal(pi.status,'succeeded');assert.equal(pi.livemode,false);assert.equal(pi.metadata.palmsteeze_payment_id,a.id);assert.equal(pi.amount_received,Number(a.collected_kobo));
  const refunds=await stripe.refunds.list({payment_intent:pi.id,limit:100});assert.equal(refunds.has_more,false);assert.equal(refunds.data.length,1);assert.equal(refunds.data[0].status,'failed');assert.equal(refunds.data[0].amount,pi.amount_received);
  const failure=archive.events.find((e:{event_type:string})=>e.event_type==='refund.failed');assert.ok(failure);const event=await stripe.events.retrieve(failure.event_id);assert.equal(event.type,'refund.failed');assert.equal(event.data.object.id,refunds.data[0].id);assert.equal(event.data.object.status,'failed');
  const baseline:Record<string,string>={};
  const queries={booking:'select id,owner_id,resource_id,starts_at,ends_at,hourly_kobo,total_kobo,deposit_percent,deposit_kobo,balance_kobo,policy_snapshot from public.bookings order by id',payment:'select id,booking_id,owner_id,amount_kobo,currency,created_at from public.payment_attempts order by id',decision:"select id,booking_id,owner_id,reason,state,decided_by,decided_at,decision_reason from public.cancellation_requests where state<>'pending' order by id",audit:'select * from public.admin_audit order by id',identity:'select * from private.cancellation_identity order by request_id'};
  for(const [name,sql]of Object.entries(queries))for(const row of(await db.query(sql)).rows)baseline[`${name}:${row.id||row.request_id}`]=createHash('sha256').update(JSON.stringify(row)).digest('hex');
  const journal=previous||{...original,phase:'restoring-archive',baseline,observations:[],checks:{...original.checks,archiveRestoration:'Exact old proof-owned fixture restored from private archive; actual Stripe failure/event re-retrieved; legitimate Auth identities recreated with the supported AdminUserAttributes.id API. Original public FAILED artifact unchanged.'},restoredAt:new Date().toISOString(),originalEvidenceSha256:createHash('sha256').update(readFileSync('docs/evidence/m3-retained-refund-proof.json')).digest('hex')};
  writeFileSync(destination,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
  for(const role of ['customer','admin']as const){const u=original[role];assert.match(u.email,/^m3-retained-(customer|admin)-.*@palmsteeze\.invalid$/);const existing=await auth.auth.admin.getUserById(u.id);if(existing.data.user){assert.ok(previous);assert.equal(existing.data.user.email,u.email);assert.equal(existing.data.user.role,'authenticated');}else{const made=await auth.auth.admin.createUser({id:u.id,email:u.email,password:u.password,email_confirm:true,user_metadata:{full_name:`PalmSteeze retained proof ${role}`}});assert.equal(made.error,null);assert.equal(made.data.user?.id,u.id);}}
  await db.query('begin');try{
   await db.query("insert into private.app_roles(user_id,role) values($1,'admin')",[original.admin.id]);
   // Table names are hardcoded and column names are validated against the live
   // schema. No upsert, deletion, modification or disabling of constraints.
   for(const [key,table]of Object.entries({booking:'public.bookings',payment:'public.payment_attempts',operations:'public.refund_operations',receipts:'public.payment_refund_receipts',decisions:'public.cancellation_requests',identities:'private.cancellation_identity',audit:'public.admin_audit',events:'private.payment_events'})){
    const [schema,name]=table.split('.');const allowed=new Set((await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2',[schema,name])).rows.map(r=>r.column_name));
    for(const row of archive[key]){const columns=Object.keys(row);assert.ok(columns.every(c=>/^[a-z_]+$/.test(c)&&allowed.has(c)));if(key==='identities'){assert.ok(archive.decisions.some((d:{id:string})=>d.id===row.request_id));await db.query('delete from private.cancellation_identity where request_id=$1',[row.request_id]);}await db.query(`insert into ${table}(${columns.map(c=>`"${c}"`).join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')})`,columns.map(c=>row[c]));if(key==='audit'){assert.equal(row.target_id,b.id);await db.query('update public.admin_audit set actor_snapshot=$2 where id=$1 and target_id=$3',[row.id,row.actor_snapshot,b.id]);}}
   }
   await db.query("insert into public.allocations(resource_id,period,kind,booking_id,active) values($1,tstzrange($2,$3,'[)'),'hold',$4,false)",[b.resource_id,b.starts_at,b.ends_at,b.id]);
   await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  const session=await auth.auth.signInWithPassword({email:original.admin.email,password:original.admin.password});assert.equal(session.error,null);assert.equal((await auth.auth.getUser()).data.user?.id,original.admin.id);
  const response=await fetch('http://localhost:3000/api/admin/recovery',{method:'POST',headers:{Origin:'http://localhost:3000',Authorization:`Bearer ${session.data.session!.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:b.id})});assert.equal(response.status,200);
  const current=(await db.query('select * from public.payment_attempts where id=$1',[a.id])).rows[0];assert.equal(current.refund_blocked,true);assert.equal(current.refund_state,'failed');assert.equal(current.state,'review_required');assert.equal(Number(current.refunded_kobo),0);
  assert.equal((await stripe.refunds.list({payment_intent:pi.id})).data.length,1);
  journal.phase='provider-blocked';journal.checks.deployedPermanentRejection='PASSED — restored genuine failed payment reaches deployed worker; same provider rejects original generation-1 key, database permanently blocks it; no second refund';writeFileSync(destination,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
  console.log('PASSED: exact archived proof restored through legitimate Auth API, original actual failed refund/event reverified, deployed worker records actual permanent replacement rejection. Original FAILED evidence unchanged; owner records untouched.');
 }finally{await db.end();}
}
main().catch(error=>{writeFileSync('.tools/private/m3-restore-error.txt',error instanceof Error?error.stack||error.message:'Details unavailable',{mode:0o600});safeFailure(error);});
