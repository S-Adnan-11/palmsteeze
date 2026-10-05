import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import type Stripe from 'stripe';
import { verifiedStripeSandbox } from './lib/stripe-sandbox';
import { ReadinessError,safeFailure } from './lib/database';

async function main() {
  const stripe=await verifiedStripeSandbox();const run=randomUUID();
  const evidence:Record<string,unknown>={checkedAt:new Date().toISOString(),currency:'ngn',amountKobo:80000,
    proofScope:'Checkout creation only; no completed payment, webhook or refund is established'};
  let session:Stripe.Checkout.Session|undefined;
  try {
    session=await stripe.checkout.sessions.create({mode:'payment',ui_mode:'hosted_page',allowed_payment_method_types:['card'],
      adaptive_pricing:{enabled:false},line_items:[{quantity:1,price_data:{currency:'ngn',unit_amount:80000,
        product_data:{name:'PalmSteeze sandbox amount proof - no real booking'}}}],
      metadata:{palmsteeze_proof_run:run},payment_intent_data:{metadata:{palmsteeze_proof_run:run}},
      success_url:'http://localhost:3101/result',cancel_url:'http://localhost:3101/cancel',
      expires_at:Math.floor(Date.now()/1000)+31*60,
    },{idempotencyKey:`palmsteeze-amount-proof-${run}`});
    assert.equal(session.livemode,false);assert.equal(session.currency,'ngn');assert.equal(session.amount_total,80000);
    assert.deepEqual(session.payment_method_types,['card']);
    evidence.checkoutCreation='PASSED';
    console.log('PASSED: approved NGN 800 card-only hosted Checkout creation accepted. This does not prove successful charge, webhook or refund.');
  } catch(error) {
    evidence.checkoutCreation='FAILED';
    const provider=error as {type?:string;code?:string;statusCode?:number;param?:string;message?:string};
    if (provider.type?.startsWith('Stripe')) {
      const safe=(v:unknown)=>typeof v==='string' && /^[A-Za-z0-9_.-]{1,80}$/.test(v) ? v : null;
      evidence.providerFailure={type:safe(provider.type),code:safe(provider.code),status:provider.statusCode,param:safe(provider.param)};
      mkdirSync('.tools/private/stripe',{recursive:true});
      writeFileSync('.tools/private/stripe/amount-error.txt',provider.message||'',{mode:0o600});
      const message=provider.message||'';
      const minimum=message.match(/at least\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z]{3})\b/i);
      if (minimum) evidence.providerMinimum={amount:minimum[1],currency:minimum[2].toUpperCase()};
      const cents=message.match(/convert to at least (\d+) cents/i);
      const converted=message.match(/converts to approximately \$(\d+(?:\.\d+)?)/i);
      if (cents && converted) {
        evidence.providerMinimum={amount:Number(cents[1])/100,currency:'USD',basis:'provider-reported converted-charge minimum'};
        evidence.providerApproximateConversion={amount:Number(converted[1]),currency:'USD',basis:'provider estimate at request time; not a fixed exchange rate'};
      }
      evidence.providerMentionsMinimum=/minimum|at least|too small/i.test(message);
      throw new ReadinessError(`FAILED: approved NGN 800 Checkout creation (${safe(provider.type)}, ${safe(provider.code)||'no code'}, HTTP ${provider.statusCode||'unknown'}). No further policy change; provider details saved privately.`);
    }
    throw new ReadinessError('FAILED: amount proof assertion; sensitive provider details withheld.');
  } finally {
    if (session) {
      const current=await stripe.checkout.sessions.retrieve(session.id);
      assert.equal(current.status,'open');assert.equal(current.payment_status,'unpaid');
      const expired=await stripe.checkout.sessions.expire(session.id);assert.equal(expired.status,'expired');
      evidence.runOwnedUnpaidSessionExpired='PASSED';
    }
    mkdirSync('docs/evidence',{recursive:true});
    writeFileSync('docs/evidence/m2b-stripe-amount.json',JSON.stringify(evidence,null,2)+'\n');
  }
}
main().catch(safeFailure);
