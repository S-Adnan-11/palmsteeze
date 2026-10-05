import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {verifyProject,connectDatabase,safeFailure} from './lib/database';
import {verifiedStripeSandbox} from './lib/stripe-sandbox';
async function main(){
 await verifyProject();const stripe=await verifiedStripeSandbox();const db=await connectDatabase();
 try{
  await db.query('begin read only');
  const stats=(await db.query(`select
   (select count(*)::int from public.bookings b join public.payment_attempts p on p.booking_id=b.id where p.payment_intent_id is not null and b.owner_id in(select id from auth.users where email not like '%@palmsteeze.invalid')) as customer_collected_records,
   (select count(*)::int from public.cancellation_requests where state='approved' and owner_id in(select id from auth.users where email not like '%@palmsteeze.invalid')) as approved_requests,
   (select count(*)::int from public.cancellation_requests where state='rejected' and owner_id in(select id from auth.users where email not like '%@palmsteeze.invalid')) as rejected_requests,
   (select count(*)::int from public.admin_audit where actor_id in(select id from auth.users where email not like '%@palmsteeze.invalid')) as real_account_audit_entries,
   (select count(*)::int from public.allocations where kind='closure') as retained_closure_records`)).rows[0];
  const payments=(await db.query(`select p.payment_intent_id,p.amount_kobo from public.payment_attempts p join auth.users u on u.id=p.owner_id where p.payment_intent_id is not null and u.email not like '%@palmsteeze.invalid'`)).rows;
  await db.query('commit');let verifiedCollected=0,fullyRefunded=0;
  for(const p of payments){const pi=await stripe.paymentIntents.retrieve(p.payment_intent_id);assert.equal(pi.livemode,false);assert.equal(pi.currency,'ngn');assert.equal(pi.amount_received,Number(p.amount_kobo));verifiedCollected++;
   const refunds=await stripe.refunds.list({payment_intent:pi.id,limit:100});assert.equal(refunds.has_more,false);if(refunds.data.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0)===pi.amount_received) fullyRefunded++;
  }
  const observations=['customer payment and approved refund','rejected refund reflected to customer','audit history','closure blocking customer booking','signed-out admin access','identity attribution','repeat requests after rejection','higher/full payment followed by refund'];
  const revisedPath='docs/evidence/m3-revised-acceptance.json';const revised=existsSync(revisedPath)?JSON.parse(readFileSync(revisedPath,'utf8')):null;
  const providerStatus=revised?.status?.startsWith('PASSED')&&revised?.newReplacementCreation?.startsWith('FAILED')?'FAILED — actual provider permanently refused replacement; owner-approved safe exception handling separately PASSED (m3-revised-acceptance.json)':'NOT RUN — separate proof remains open';
  const evidence={checkedAt:new Date().toISOString(),ownerObserved:Object.fromEntries(observations.map(x=>[x,'PASSED — owner reported; no claim of an independently observed walkthrough'])),recordCorroboration:{...stats,authoritative_sandbox_collected_records:verifiedCollected,authoritative_fully_refunded_records:fullyRefunded},limits:'Records corroborate collected/refunded payments, decisions, audit and closures. They do not independently establish the exact UI clicks, rejected-request display, closure-block attempt or sign-out observation.',actualProviderFailedRefundReplacement:providerStatus};
  mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m3-owner-acceptance.json',JSON.stringify(evidence,null,2)+'\n');console.log('PASSED: owner acceptance recorded; read-only record/provider corroboration saved without customer identities.');
 }finally{await db.end();}
}
main().catch(safeFailure);
