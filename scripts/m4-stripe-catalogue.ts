import Stripe from 'stripe';
import {chromium} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {sandboxCards} from '../src/lib/sandbox-cards';

async function main(){
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New evidence run required');
  const run=randomUUID(),output=join(root,'stripe-catalogue-'+Date.now()+'-'+run.slice(0,8));mkdirSync(output);
  loadLocalEnvironment();const key=process.env.STRIPE_SECRET_KEY||'';
  if(!/^(sk_test_|rk_test_|rkcs_test_)/.test(key)||process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED!=='true')throw new Error('Confirmed sandbox/test key required');
  const stripe=new Stripe(key,{maxNetworkRetries:1,timeout:15000});
  if((await stripe.accounts.retrieveCurrent()).id!==process.env.STRIPE_ACCOUNT_ID)throw new Error('Sandbox account mismatch');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const results:Record<string,unknown>[]=[];
  try {
    for(const card of sandboxCards.filter(card=>!process.argv[3]||card.id===process.argv[3])) {
      const context=await browser.newContext();const page=await context.newPage();let session:Stripe.Checkout.Session|undefined;
      const result:Record<string,unknown>={cardId:card.id,kind:'Genuine standalone Stripe sandbox hosted Checkout; exact official catalogue number entered only into Stripe UI',amountKobo:80000,currency:'ngn'};
      try {
        const metadata={palmsteeze_catalogue_proof:run,card_id:card.id};
        session=await stripe.checkout.sessions.create({mode:'payment',ui_mode:'hosted_page',allowed_payment_method_types:['card'],adaptive_pricing:{enabled:false},line_items:[{quantity:1,price_data:{currency:'ngn',unit_amount:80000,product_data:{name:'PalmSteeze sandbox catalogue compatibility proof'}}}],payment_intent_data:{metadata},metadata,success_url:'http://localhost:3000/terms?catalogue=returned',cancel_url:'http://localhost:3000/terms',expires_at:Math.floor(Date.now()/1000)+31*60},{idempotencyKey:'m4-catalogue-'+run+'-'+card.id});
        if(session.livemode!==false||!session.url)throw new Error('Sandbox hosted session required');
        await page.goto(session.url);await page.locator('#email').fill(`catalogue-${run}@palmsteeze.invalid`,{timeout:45000});
        await page.locator('#cardNumber').fill(card.number);await page.locator('#cardExpiry').fill('1230');await page.locator('#cardCvc').fill(card.cvcLength===4?'1234':'123');
        if(await page.locator('#billingName').isVisible())await page.locator('#billingName').fill('PalmSteeze sandbox visitor');
        if(await page.locator('#billingPostalCode').isVisible())await page.locator('#billingPostalCode').fill('10001');
        await page.locator('button[type=submit]').click();await page.waitForURL('http://localhost:3000/terms?catalogue=returned',{timeout:60000});
        const verified=await stripe.checkout.sessions.retrieve(session.id,{expand:['payment_intent']});const intent=verified.payment_intent as Stripe.PaymentIntent;
        if(verified.livemode!==false||verified.payment_status!=='paid'||verified.amount_total!==80000||intent.status!=='succeeded'||intent.amount_received!==80000)throw new Error('Authoritative sandbox payment verification failed');
        result.success=true;result.sessionId=verified.id;result.paymentIntentId=intent.id;result.livemode=false;result.paymentStatus=verified.payment_status;result.amountReceived=intent.amount_received;
        const refund=await stripe.refunds.create({payment_intent:intent.id,amount:80000,metadata},{idempotencyKey:'m4-catalogue-refund-'+run+'-'+card.id});
        result.refund={id:refund.id,status:refund.status,amount:refund.amount};
        console.log('Verified hosted sandbox card: '+card.id+'; refund status: '+refund.status);
      } catch(error) {
        result.success=false;result.error=error instanceof Error&&error.name==='TimeoutError'?'Hosted UI timeout; inspect new run evidence':'Provider check failed; private details withheld';
        const provider=error as {type?:string;code?:string;param?:string;statusCode?:number};const safe=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.[\]-]{1,120}$/.test(value)?value:undefined;
        result.diagnostic={type:safe(provider.type),code:safe(provider.code),param:safe(provider.param),status:provider.statusCode};
        if(session){const current=await stripe.checkout.sessions.retrieve(session.id);result.sessionId=current.id;result.providerPaymentStatus=current.payment_status;if(current.status==='open')await stripe.checkout.sessions.expire(current.id);}
        console.log('Catalogue check incomplete: '+card.id);
      } finally {await context.close();writeFileSync(join(output,card.id+'.json'),JSON.stringify(result,null,2),{flag:'wx'});results.push(result);}
    }
    writeFileSync(join(output,'summary.json'),JSON.stringify({at:new Date().toISOString(),kind:'Genuine-provider sandbox catalogue proof; standalone sessions, no app reservation/RPC substitution',confirmedSuccessful:results.filter(result=>result.success).length,expected:10,results},null,2),{flag:'wx'});
    if(results.some(result=>!result.success))process.exitCode=1;
    console.log('Catalogue evidence: '+output);
  }finally{await browser.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Catalogue proof failed');process.exitCode=1;});
