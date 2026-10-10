import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {sandboxCards} from '../src/lib/sandbox-cards';

async function main(){
  const root=resolve(process.argv[2]||''),source=resolve(process.argv[3]||'');
  if(!existsSync(join(root,'run.json'))||!source.startsWith(root+'\\'))throw new Error('This run’s original catalogue evidence required');
  const prior=JSON.parse(readFileSync(join(source,'summary.json'),'utf8')) as {results:{cardId:string;sessionId?:string}[]};
  assert.equal(prior.results.length,10);
  const output=join(root,'stripe-catalogue-verified-'+Date.now()+'-'+randomUUID().slice(0,8));mkdirSync(output);
  loadLocalEnvironment();const key=process.env.STRIPE_SECRET_KEY||'';assert.match(key,/^(sk_test_|rk_test_|rkcs_test_)/);assert.equal(process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED,'true');
  const stripe=new Stripe(key,{maxNetworkRetries:1,timeout:15000});assert.equal((await stripe.accounts.retrieveCurrent()).id,process.env.STRIPE_ACCOUNT_ID);
  const results=[];
  for(const entry of prior.results) {
    assert.ok(entry.sessionId);const card=sandboxCards.find(card=>card.id===entry.cardId);assert.ok(card);
    const session=await stripe.checkout.sessions.retrieve(entry.sessionId,{expand:['payment_intent']});
    assert.equal(session.livemode,false);assert.equal(session.status,'complete');assert.equal(session.payment_status,'paid');assert.equal(session.currency,'ngn');assert.equal(session.amount_total,80000);
    assert.equal(session.metadata?.card_id,card.id);assert.ok(session.metadata?.palmsteeze_catalogue_proof);assert.equal(session.metadata?.palmsteeze_payment_id,undefined);
    const intent=session.payment_intent as Stripe.PaymentIntent;assert.equal(intent.status,'succeeded');assert.equal(intent.amount_received,80000);assert.equal(intent.livemode,false);
    const refund=await stripe.refunds.create({payment_intent:intent.id,amount:80000,metadata:{palmsteeze_catalogue_proof:session.metadata!.palmsteeze_catalogue_proof,card_id:card.id}},{idempotencyKey:'m4-catalogue-refund-'+session.id});
    const verified=await stripe.refunds.retrieve(refund.id);assert.equal(verified.status,'succeeded');assert.equal(verified.amount,80000);
    const result={cardId:card.id,kind:'Genuine hosted sandbox payment and authoritative re-retrieval; original navigation-failed harness evidence retained',sessionId:session.id,paymentIntentId:intent.id,livemode:false,paymentStatus:session.payment_status,amountReceived:intent.amount_received,currency:'ngn',cardEvidence:'Exact official number entered into hosted Stripe by the original runner; separate payment-method retrieval unavailable with restricted key (403 more_permissions_required)',refund:{id:verified.id,status:verified.status,amount:verified.amount}};
    results.push(result);writeFileSync(join(output,card.id+'.json'),JSON.stringify(result,null,2),{flag:'wx'});
    console.log('Verified payment and completed sandbox refund: '+card.id);
  }
  writeFileSync(join(output,'summary.json'),JSON.stringify({at:new Date().toISOString(),originalHarness:source,originalFailure:'Test server stopped while hosted success navigation returned; original report marked checks incomplete. This independent proof retrieves actual paid sessions and verifies refunds without recreating payments.',successful:results.length,results},null,2),{flag:'wx'});
  console.log('Verified catalogue evidence: '+output);
}
void main().catch(error=>{const safe=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.[\]-]{1,120}$/.test(value)?value:undefined;const fault=error as {name?:string;type?:string;code?:string;param?:string;statusCode?:number};console.error(JSON.stringify({check:'catalogue reconciliation',name:safe(fault.name),type:safe(fault.type),code:safe(fault.code),param:safe(fault.param),status:fault.statusCode}));process.exitCode=1;});
