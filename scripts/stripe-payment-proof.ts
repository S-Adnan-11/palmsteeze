import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type Stripe from 'stripe';
import { verifiedStripeSandbox,savePrivateEnvironment } from './lib/stripe-sandbox';
import { ReadinessError,safeFailure } from './lib/database';

async function main() {
  const stripe=await verifiedStripeSandbox();const run=randomUUID();const origin='http://localhost:3101';
  const evidence:Record<string,unknown>={checkedAt:new Date().toISOString(),currency:'ngn',depositKobo:80000,depositPercent:40,policyBasis:'current 40% working default after sandbox minimum-amount rejection'};
  const types=new Set<string>();let signingSecret='';let checkout:Stripe.Checkout.Session|undefined;
  const server=createServer(async (request,response)=>{
    response.setHeader('Cache-Control','private, no-store');
    if (request.method==='GET' && request.url==='/checkout' && checkout?.url) {
      response.writeHead(303,{Location:checkout.url});response.end();return;
    }
    if (request.method==='GET' && ['/result','/cancel'].includes(request.url||'')) {
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.end('<!doctype html><title>PalmSteeze sandbox proof</title><p>Browser returned. Payment status is verified separately with Stripe; this URL does not confirm payment.</p>');return;
    }
    if (request.method!=='POST' || request.url!=='/webhook') {response.writeHead(404);response.end();return;}
    const parts:Buffer[]=[];let size=0;
    for await (const part of request) {size+=part.length;if (size>256*1024) {response.writeHead(413);response.end();return;}parts.push(part);}
    try {
      const signature=request.headers['stripe-signature'];
      if (!signingSecret || typeof signature!=='string') throw new Error('Signature required');
      const event=stripe.webhooks.constructEvent(Buffer.concat(parts),signature,signingSecret);
      const object=event.data.object as unknown as {metadata?:Record<string,string>};
      if (event.livemode || object.metadata?.palmsteeze_proof_run!==run) {response.writeHead(200);response.end();return;}
      types.add(event.type);response.writeHead(200);response.end();
    } catch {response.writeHead(400);response.end();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(3101,'127.0.0.1',resolve);});
  mkdirSync('.tools/private/stripe',{recursive:true});
  const env:NodeJS.ProcessEnv={NODE_ENV:'development',STRIPE_API_KEY:process.env.STRIPE_SECRET_KEY};
  for (const name of ['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA']) env[name]=process.env[name];
  const listener=spawn(resolve('node_modules/@stripe/cli-win32-x64/bin/stripe.exe'),[
    '--config',resolve('.tools/private/stripe/config.toml'),'--project-name','palmsteeze','--color','off',
    'listen','--forward-to','http://127.0.0.1:3101/webhook','--events','checkout.session.completed,payment_intent.succeeded,charge.refunded,refund.created,refund.updated',
  ],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';
  const capture=(chunk:Buffer)=>{logs+=chunk.toString();const found=logs.match(/whsec_[A-Za-z0-9]+/);if (found) signingSecret=found[0];};
  listener.stdout.on('data',capture);listener.stderr.on('data',capture);
  listener.on('error',()=>{});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  let page:Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>|undefined;
  let stage='webhook-listener';
  try {
    for (let attempt=0;attempt<30 && !signingSecret;attempt++) await new Promise(resolve=>setTimeout(resolve,1000));
    if (!signingSecret) throw new ReadinessError('NOT RUN: Stripe CLI webhook listener did not establish access; private diagnostic saved. Verify Events/listener permissions in the sandbox key.');
    savePrivateEnvironment({STRIPE_WEBHOOK_SECRET:signingSecret});
    const forged=await fetch(`${origin}/webhook`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t=1,v1=invalid'},body:'{}'});
    assert.equal(forged.status,400);evidence.forgedSignatureRejected='PASSED';
    const metadata={palmsteeze_proof_run:run};
    stage='checkout-creation';
    checkout=await stripe.checkout.sessions.create({mode:'payment',ui_mode:'hosted_page',allowed_payment_method_types:['card'],
      adaptive_pricing:{enabled:false},line_items:[{quantity:1,price_data:{currency:'ngn',unit_amount:80000,
        product_data:{name:'PalmSteeze sandbox feasibility deposit — no real booking'}}}],
      payment_intent_data:{metadata},metadata,success_url:`${origin}/result`,cancel_url:`${origin}/cancel`,
      expires_at:Math.floor(Date.now()/1000)+31*60,
    },{idempotencyKey:`palmsteeze-feasibility-${run}`});
    assert.equal(checkout.livemode,false);assert.equal(checkout.amount_total,80000);assert.equal(checkout.currency,'ngn');
    assert.deepEqual(checkout.payment_method_types,['card']);assert.equal(Boolean(checkout.url),true);
    const url=new URL(checkout.url!);assert.equal(url.protocol==='https:' && url.hostname==='checkout.stripe.com',true);
    const privateRecord=JSON.stringify({run,account:process.env.STRIPE_ACCOUNT_ID,session:checkout.id,url:checkout.url},null,2);
    writeFileSync('.tools/private/stripe/payment-proof.json',privateRecord,{mode:0o600});
    writeFileSync(`.tools/private/stripe/payment-proof-${run}.json`,privateRecord,{mode:0o600});
    evidence.cardOnlyHostedSession='PASSED';
    console.log('PASSED: real card-only hosted Checkout Session created for approved NGN 800 / 80,000 kobo. Payment success still pending, not inferred from creation.');
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext();page=await context.newPage();
    stage='hosted-checkout-form';
    // Genuine Stripe hosted UI and documented sandbox card; no payment API shortcut.
    await page.goto(`${origin}/checkout`,{waitUntil:'domcontentloaded'});
    await page.locator('#email').fill(`m2b-${run}@palmsteeze.invalid`,{timeout:30000});
    await page.locator('#cardNumber').fill('4242424242424242');
    await page.locator('#cardExpiry').fill('1234');await page.locator('#cardCvc').fill('123');
    if (await page.locator('#billingName').isVisible()) await page.locator('#billingName').fill('PalmSteeze sandbox fixture');
    if (await page.locator('#billingPostalCode').isVisible()) await page.locator('#billingPostalCode').fill('10001');
    await page.locator('button[type=submit]').click();
    await page.waitForURL(`${origin}/result`,{timeout:60000});
    stage='authoritative-payment-retrieval';
    const result=await stripe.checkout.sessions.retrieve(checkout.id,{expand:['payment_intent']});
    assert.equal(result.livemode,false);assert.equal(result.status,'complete');assert.equal(result.payment_status,'paid');
    assert.equal(result.amount_total,80000);assert.equal(result.currency,'ngn');assert.equal(result.metadata?.palmsteeze_proof_run,run);
    const intent=result.payment_intent as Stripe.PaymentIntent;
    assert.equal(intent.status,'succeeded');assert.equal(intent.amount_received,80000);assert.equal(intent.currency,'ngn');assert.equal(intent.livemode,false);
    evidence.hostedPaymentAndAuthoritativeRetrieval='PASSED';
    stage='natural-signed-webhook-delivery';
    for (let attempt=0;attempt<30 && !types.has('checkout.session.completed');attempt++) await new Promise(resolve=>setTimeout(resolve,1000));
    assert.equal(types.has('checkout.session.completed'),true);evidence.realSignedWebhookDelivery='PASSED';
    stage='full-sandbox-refund';
    const refund=await stripe.refunds.create({payment_intent:intent.id,amount:80000,metadata},{idempotencyKey:`palmsteeze-feasibility-refund-${run}`});
    const retrieved=await stripe.refunds.retrieve(refund.id);
    assert.equal(retrieved.status,'succeeded');assert.equal(retrieved.amount,80000);assert.equal(retrieved.currency,'ngn');
    evidence.fullSandboxRefund='PASSED';
    console.log('PASSED: real hosted sandbox payment, signed webhook delivery, authoritative Session/PaymentIntent retrieval and full NGN 800 sandbox refund. No real funds or customer bookings touched.');
  } catch(error) {
    evidence.remainingPaymentGate='NOT PASSED';
    evidence.failureStage=stage;
    if (page && !page.isClosed()) {
      await page.screenshot({path:'.tools/private/stripe/checkout-proof-failure.png',fullPage:true}).catch(()=>{});
      const fields=await page.locator('input').evaluateAll(items=>items.map(item=>({id:item.id,type:item.getAttribute('type')}))).catch(()=>[]);
      writeFileSync('.tools/private/stripe/checkout-input-fields.json',JSON.stringify(fields),{mode:0o600});
    }
    const provider=error as {type?:string;code?:string;statusCode?:number;param?:string};
    if (typeof provider.type==='string' && provider.type.startsWith('Stripe')) {
      evidence.providerFailure={type:provider.type,code:provider.code||null,status:provider.statusCode||null,param:provider.param||null};
      const minimum=(error as {message?:string}).message?.match(/at least\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z]{3})\b/i);
      if (minimum) evidence.providerMinimum={amount:minimum[1],currency:minimum[2].toUpperCase()};
      throw new ReadinessError(`FAILED: sandbox payment proof provider result (${provider.type}, ${provider.code||'no code'}, HTTP ${provider.statusCode||'unknown'}); amount/currency/policy unchanged. See sanitized evidence. Provider text withheld to avoid credential disclosure.`);
    }
    throw error;
  } finally {
    if (browser) await browser.close();listener.kill();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    writeFileSync('.tools/private/stripe/listener-output.txt',logs,{mode:0o600});
    if (checkout) {
      // Expire only this run's unpaid open proof session. Paid fixture is retained/refunded,
      // never deleted and never confused with an existing customer booking.
      const current=await stripe.checkout.sessions.retrieve(checkout.id);
      if (current.status==='open' && current.payment_status==='unpaid') await stripe.checkout.sessions.expire(checkout.id);
    }
    mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m2b-stripe-payment.json',JSON.stringify(evidence,null,2)+'\n');
  }
}
main().catch(safeFailure);
