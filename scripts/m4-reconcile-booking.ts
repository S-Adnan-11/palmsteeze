import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {chromium} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {connectDatabase,inspectDatabase} from './lib/database';

async function main(){
  const root=resolve(process.argv[2]||''),fixture=resolve(process.argv[3]||'');
  if(!existsSync(join(root,'run.json'))||!fixture.startsWith(root+'\\'))throw new Error('This run\'s retained fixture required');
  const {userId,bookingIds}=JSON.parse(readFileSync(fixture,'utf8')) as {userId:string;bookingIds:string[]};assert.equal(bookingIds.length,1);
  const output=join(root,'booking-verified-'+Date.now()+'-'+randomUUID().slice(0,8));mkdirSync(output);
  const db=await connectDatabase();await inspectDatabase(db);
  try{
    const row=(await db.query('select b.id,b.owner_id,b.state booking_state,b.total_kobo,b.created_at,u.email,p.session_id,p.state payment_state,p.amount_kobo,p.collected_kobo from public.bookings b join auth.users u on u.id=b.owner_id join public.payment_attempts p on p.booking_id=b.id where b.id=$1 and b.owner_id=$2',[bookingIds[0],userId])).rows[0];
    assert.match(row.email,/^m4-targeted-.*@palmsteeze\.invalid$/);assert.ok(new Date(row.created_at).getTime()>Date.parse(JSON.parse(readFileSync(join(root,'run.json'),'utf8')).startedAt));
    assert.equal(row.booking_state,'confirmed');assert.equal(row.payment_state,'paid');assert.equal(Number(row.amount_kobo),100001);assert.equal(Number(row.collected_kobo),100001);
    const key=process.env.STRIPE_SECRET_KEY||'';assert.match(key,/^(sk_test_|rk_test_|rkcs_test_)/);assert.equal(process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED,'true');
    const stripe=new Stripe(key,{maxNetworkRetries:1,timeout:15000});assert.equal((await stripe.accounts.retrieveCurrent()).id,process.env.STRIPE_ACCOUNT_ID);
    const session=await stripe.checkout.sessions.retrieve(row.session_id,{expand:['payment_intent']});const intent=session.payment_intent as Stripe.PaymentIntent;
    assert.equal(session.livemode,false);assert.equal(session.payment_status,'paid');assert.equal(session.currency,'ngn');assert.equal(session.amount_total,100001);assert.equal(intent.status,'succeeded');assert.equal(intent.amount_received,100001);
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    // Reset only this run's synthetic fixture password to inspect its owned UI.
    const password=randomBytes(32).toString('base64url');assert.equal((await admin.auth.admin.updateUserById(userId,{password})).error,null);
    const jar=new Map<string,string>();const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
    assert.equal((await client.auth.signInWithPassword({email:row.email,password})).error,null);
    const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
    try{
      const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([...jar].filter(([,value])=>value).map(([name,value])=>({name,value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax' as const})));
      const page=await context.newPage();await page.route('https://lh3.googleusercontent.com/**',route=>route.abort());
      await page.goto('http://localhost:3000/verify?next=/');await page.waitForURL('http://localhost:3000/',{timeout:30000});await page.getByRole('button',{name:'Necessary only',exact:true}).click();
      await page.goto('http://localhost:3000/booking/'+row.id+'?checkout=returned');await page.locator('[data-testid=booking-state]').filter({hasText:'confirmed'}).waitFor();await page.locator('[data-testid=payment-state]').filter({hasText:'paid'}).waitFor();
      assert.equal(await page.locator('.sandbox-card-helper').count(),0);writeFileSync(join(output,'payment-confirmed-desktop.png'),await page.screenshot({fullPage:true}),{flag:'wx'});
      await page.goto('http://localhost:3000/booking/'+row.id+'/test-card');assert.equal(await page.locator('.sandbox-card-helper').count(),0);
      writeFileSync(join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),kind:'Genuine hosted Stripe sandbox payment independently reconciled after test return-URL expectation error; official Cloudflare test keys and explicitly seeded synthetic Google identity, not genuine Turnstile or OAuth',originalFixture:fixture,bookingId:row.id,providerSessionId:session.id,paymentIntentId:intent.id,livemode:false,currency:'ngn',amountKobo:100001,amountReceived:100001,bookingState:'confirmed',paymentState:'paid',totalKobo:Number(row.total_kobo),collectedKobo:Number(row.collected_kobo),paidHelperHidden:true,paidCompanionClosed:true,retainedAsNewPaidEvidence:true},null,2),{flag:'wx'});
    }finally{await browser.close();}
    console.log('Existing sandbox booking payment independently verified: '+output);
  }finally{await db.end();}
}
void main().catch(error=>{console.error('Existing booking reconciliation failed: '+(error?.name||'Error'));process.exitCode=1;});
