import {writeFileSync,mkdirSync} from 'node:fs';
import {verifiedStripeSandbox} from './lib/stripe-sandbox';
import {safeFailure} from './lib/database';
async function main(){
 const stripe=await verifiedStripeSandbox();const observations:{refundStatus:string;cardEnding:string;ageMinutes:number}[]=[];
 const list=await stripe.refunds.list({limit:100,created:{gte:Math.floor(Date.parse('2026-10-03T00:00:00Z')/1000)}});
 for(const r of list.data){if(r.metadata?.palmsteeze_environment!=='development'||!r.metadata.palmsteeze_payment_id||typeof r.charge!=='string') continue;
  const charge=await stripe.charges.retrieve(r.charge);if(charge.livemode!==false||charge.payment_method_details?.card?.last4!=='5126'||!charge.billing_details?.email?.endsWith('@palmsteeze.invalid')) continue;
  observations.push({refundStatus:r.status||'unavailable',cardEnding:'5126',ageMinutes:Math.floor((Date.now()/1000-r.created)/60)});
 }
 const evidence={checkedAt:new Date().toISOString(),operation:'Read-only existing PalmSteeze run-owned asynchronous-failure sandbox refund retrieval',boundedLatest100:list.has_more,observations,actualFailedResult:observations.some(r=>r.refundStatus==='failed')?'PASSED — provider retrieval only':'NOT RUN — no actual failed result observed',replacementIntegration:'NOT RUN — separate retained integration assertions remain open',source:'https://docs.stripe.com/testing#simulate-an-asynchronous-refund',limits:'Stripe says some time later; no fixed transition bound. No new charge, refund, fixture restoration or provider-state mutation performed.'};
 mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m3-async-refund-followup.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
main().catch(safeFailure);
