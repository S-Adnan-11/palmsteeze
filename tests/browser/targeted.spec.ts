import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {randomUUID,randomBytes} from 'node:crypto';
import type {Client} from 'pg';
import Stripe from 'stripe';
import {connectDatabase,inspectDatabase} from '../../scripts/lib/database';
import {initialBookingDate,intervalFromSelection} from '../../src/lib/domain';
import {visitDestination} from '../../src/lib/auth/destinations';
import {createClearance} from '../../src/lib/security-sessions';
import {capture,record} from './targeted-artifacts';
import {sandboxCards} from '../../src/lib/sandbox-cards';

const origin='http://localhost:3000';
let db:Client,admin:ReturnType<typeof createClient>,user:{id:string;email:string;password:string},resource:string,destination:string;
test.beforeAll(async({browserName},info)=>{
  expect(browserName).toBe('chromium');
  db=await connectDatabase();await inspectDatabase(db);
  admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`m4-targeted-${randomUUID()}@palmsteeze.invalid`,password=randomBytes(32).toString('base64url');
  const made=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(made.error||!made.data.user)throw new Error('Synthetic Auth setup failed; response withheld.');
  user={id:made.data.user.id,email,password};
  // Controlled synthetic Google identity metadata, served by real Auth after
  // password authentication. This is never evidence of actual Google OAuth.
  await db.query('insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at,last_sign_in_at) values($1,$2,$3,$4,$5,now(),now(),now())',[randomUUID(),user.id,user.id,'google',{sub:user.id,email,email_verified:true,full_name:'Demo Visitor With A Deliberately Long Display Name For Review',avatar_url:'https://lh3.googleusercontent.com/a/controlled-missing-image=s96-c'}]);
  resource=(await db.query('select id from public.resources where code=$1',[info.project.name==='desktop'?'OPEN-15':'OPEN-16'])).rows[0].id;
  const date=initialBookingDate(new Date(Date.now()+Number(process.env.PALMSTEEZE_TARGETED_DAY_OFFSET||20)*86400000));
  destination=visitDestination({resource,date,hour:11,duration:1});
});
test.afterAll(async({browserName},info)=>{
  expect(browserName).toBe('chromium');
  if(!db)return;
  try {
    if(user){
      const payments=await db.query('select id,state,collected_kobo,booking_id from public.payment_attempts where owner_id=$1',[user.id]);
      const paid=payments.rows.some(row=>Number(row.collected_kobo)>0);
      if(paid)record(`fixture-retained-${info.project.name}-${user.id}.json`,{kind:'New synthetic paid sandbox fixture retained as genuine-provider evidence; no historical records deleted',userId:user.id,bookingIds:payments.rows.map(row=>row.booking_id)});
      else {
        // Only proof-owned unpaid sessions, after authenticated stop and worker
        // reconciliation, may be cleaned. Retain uncertain fixtures for review.
        const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
        expect((await client.auth.signInWithPassword({email:user.email,password:user.password})).error).toBeNull();
        for(const payment of payments.rows) {
          const stopped=await client.rpc('request_checkout_cancel',{p_booking:payment.booking_id});
          if(stopped.error)throw new Error('Unpaid checkout stop unavailable; fixture retained');
          const worker=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:payment.booking_id})});
          expect(worker.ok).toBe(true);
        }
        await expect.poll(async()=>{
          for(const payment of payments.rows)await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:payment.booking_id})});
          return (await db.query("select count(*)::int n from public.payment_attempts where owner_id=$1 and (collected_kobo<>0 or state not in ('expired','creation_failed'))",[user.id])).rows[0].n;
        },{timeout:40000,intervals:[1000,2000,5000]}).toBe(0);
        await db.query('begin');
        try {
          await db.query("delete from private.payment_events where attempt_id in (select id from public.payment_attempts where owner_id=$1)",[user.id]);
          await db.query("delete from private.payment_jobs where attempt_id in (select id from public.payment_attempts where owner_id=$1)",[user.id]);
          await db.query('delete from public.payment_attempts where owner_id=$1',[user.id]);
          await db.query('delete from public.allocations where booking_id in (select id from public.bookings where owner_id=$1)',[user.id]);
          await db.query('delete from public.bookings where owner_id=$1',[user.id]);
          await db.query('commit');
        }catch(error){await db.query('rollback');throw error;}
        expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull();
        record(`fixture-cleanup-${info.project.name}-${user.id}.json`,{syntheticAuthRemoved:true,zeroCollectionVerified:true,unpaidExpiryVerified:true});
      }
    }
  } finally {await db.end();}
});
async function signIn(context:BrowserContext) {
  const jar=new Map<string,string>();
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
  expect((await client.auth.signInWithPassword({email:user.email,password:user.password})).error).toBeNull();
  const verified=await client.auth.getUser();expect(verified.data.user?.id).toBe(user.id);
  expect(verified.data.user?.identities?.some(identity=>identity.provider==='google')).toBe(true);
  await context.addCookies([...jar].filter(([,value])=>value).map(([name,value])=>({name,value,url:origin,httpOnly:true,sameSite:'Lax' as const})));
}
async function enter(page:Page,context:BrowserContext) {
  if(process.env.PALMSTEEZE_TARGETED_CONTROLLED==='true') {
    await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:origin,httpOnly:true,sameSite:'Lax'}]);
    await context.request.post('/api/preferences',{headers:{Origin:origin},data:{optional:false}});
    await page.goto('/');return;
  }
  await page.goto('/verify?next=/');await expect(page).toHaveURL(origin+'/',{timeout:30000});
  const banner=page.getByRole('region',{name:'Cookies and preferences'});
  if(await banner.count())await page.getByRole('button',{name:'Necessary only',exact:true}).click();
}
async function accessible(page:Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
}
async function controlledWidget(page:Page) {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{
    let serial=0;const widgets=new Map();window.widgetEvents=[];
    window.turnstile={render(node,options){const id=String(++serial);widgets.set(id,{node,options});window.widgetEvents.push({kind:'render',action:options.action,execution:options.execution,appearance:options.appearance,size:options.size});return id;},
    reset(id){window.widgetEvents.push({kind:'reset'});widgets.get(id).node.replaceChildren();},remove(id){window.widgetEvents.push({kind:'remove'});widgets.get(id)?.node.replaceChildren();widgets.delete(id);},
    execute(id){const widget=widgets.get(id);window.widgetEvents.push({kind:'execute'});widget.options['before-interactive-callback']();const button=document.createElement('button');button.textContent='Controlled verify';button.onclick=()=>{widget.options.callback('controlled-reserve-'+crypto.randomUUID());widget.node.replaceChildren();};widget.node.replaceChildren(button);}};
    window.expireLastWidget=()=>{const w=Array.from(widgets.values()).at(-1);w.node.replaceChildren();w.options['expired-callback']();};window.timeoutLastWidget=()=>{const w=Array.from(widgets.values()).at(-1);w.node.replaceChildren();w.options['timeout-callback']();};
    window.palmsteezeTurnstileLoaded?.();})();`}));
}

test('coordinated motion, stable shared popups and constrained layouts',async({page,context},info)=>{
  await enter(page,context);await page.emulateMedia({reducedMotion:'no-preference'});
  if(info.project.name==='desktop') {
    const beforeHydration=await context.browser()!.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
    await beforeHydration.addCookies(await context.cookies());const initial=await beforeHydration.newPage();await initial.goto(origin+'/');
    expect(await initial.locator('.experience-layer').first().evaluate(node=>getComputedStyle(node).position)).toBe('absolute');expect(await initial.locator('.experience-layer').nth(1).evaluate(node=>getComputedStyle(node).opacity)).toBe('0');await beforeHydration.close();
    await expect(page.locator('.workspace-experience')).toHaveAttribute('data-motion','scroll');
    const section=page.locator('.workspace-experience');
    for(const [index,progress] of [0,.5,.97].entries()) {
      await section.evaluate((node,p)=>{const rect=node.getBoundingClientRect();window.scrollTo({top:scrollY+rect.top+Math.max(1,rect.height-innerHeight*.8)*p-innerHeight*.15,behavior:'instant'});},progress);
      await expect(section).toHaveAttribute('data-scene',String(index));await expect(section.locator('.experience-steps li').nth(index)).toHaveCSS('border-left-color','rgb(23, 61, 50)');await capture(page,'motion-scene-'+index,info);
    }
    await page.emulateMedia({reducedMotion:'reduce'});await expect(section).toHaveAttribute('data-motion','static');await capture(page,'motion-reduced',info);
    await page.emulateMedia({reducedMotion:'no-preference'});await expect(section).toHaveAttribute('data-motion','scroll');
    await page.setViewportSize({width:760,height:1000});await expect(section).toHaveAttribute('data-motion','static');await page.setViewportSize({width:761,height:1000});await expect(section).toHaveAttribute('data-motion','scroll');await page.setViewportSize({width:960,height:1000});await expect(section).toHaveAttribute('data-motion','scroll');await page.setViewportSize({width:1440,height:1000});
  }else {await expect(page.locator('.workspace-experience')).toHaveAttribute('data-motion','static');await page.locator('.workspace-experience').scrollIntoViewIfNeeded();await capture(page,'motion-mobile-static',info);}
  await page.locator('#plan').scrollIntoViewIfNeeded();
  const geometry=[];
  for(const label of ['Your space','Date','Start time · WAT','Duration']) {
    const trigger=page.locator(label==='Date'?'#date':label==='Your space'?'#resource':label==='Duration'?'#duration':'#start');await expect(trigger).toBeEnabled();await trigger.scrollIntoViewIfNeeded();
    const before=await trigger.boundingBox();const scroll=await page.evaluate(()=>scrollY);await trigger.click();
    const panel=page.locator('.brand-popup');await expect(panel).toBeVisible();await page.waitForTimeout(180);
    const during=await trigger.boundingBox();expect(Math.abs(before!.x-during!.x)).toBeLessThan(1);expect(Math.abs(before!.y-during!.y)).toBeLessThan(1);expect(await page.evaluate(()=>scrollY)).toBe(scroll);
    const bounds=await panel.boundingBox();const viewport=page.viewportSize()!;expect(bounds!.x).toBeGreaterThanOrEqual(11);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width-11);expect(bounds!.y).toBeGreaterThanOrEqual(11);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height-11);
    if(label!=='Date') {await page.keyboard.press('End');await page.keyboard.press('Home');}
    await capture(page,'popup-'+label.replace(/[^a-z]+/gi,'-'),info);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBe(scroll);
    await trigger.click();await page.mouse.click(3,3);await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
    if(label==='Date'){const selected=await trigger.getAttribute('data-value');await trigger.click();await expect(page.locator('.rdp-selected button')).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();expect(await trigger.getAttribute('data-value')).not.toBe(selected);}
    geometry.push({label,before,during,popup:bounds,scrollStable:true,escape:true,outsideClick:true});
  }
  await page.locator('#resource').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(page.locator('.brand-popup')).toHaveCount(0);await expect(page.locator('#resource')).toBeFocused();
  if(info.project.name==='mobile') {const box=(await page.locator('#resource').boundingBox())!;await page.touchscreen.tap(box.x+20,box.y+20);await expect(page.locator('.brand-select-menu')).toBeVisible();await page.locator('.brand-select-item').first().tap();await expect(page.locator('.brand-popup')).toHaveCount(0);}
  await page.setViewportSize({width:320,height:480});await page.getByRole('button',{name:'Date',exact:true}).click();await expect(page.locator('.brand-calendar')).toBeVisible();await accessible(page);await capture(page,'calendar-320',info);await page.keyboard.press('Escape');
  record(`controls-${info.project.name}.json`,{kind:'Browser UI evidence; no actual phone or owner acceptance',geometry,motionNormalDesktop:info.project.name==='desktop',reducedMotionRespected:true});
});

test('account identity layout and restricted image failure fallback',async({page,context},info)=>{
  await enter(page,context);await signIn(context);
  const images:string[]=[];page.on('request',request=>{if(request.url().includes('googleusercontent'))images.push(request.url());});
  await page.route('https://lh3.googleusercontent.com/**',route=>route.abort());
  await page.goto('/account');await expect(page.locator('.account-name')).toHaveText('Demo Visitor With A Deliberately Long Display Name For Review');
  await expect(page.locator('.account-avatar')).toHaveText('DR');await expect(page.locator('.account-avatar img')).toHaveCount(0);await accessible(page);await capture(page,'account-profile',info);
  expect(images).toHaveLength(1);expect(images[0]).toMatch(/^https:\/\/lh3\.googleusercontent\.com\/a\//);
  await page.goto('/preview/admin');expect(await page.locator('.account-profile').count()).toBe(0);expect(await page.content()).not.toContain(user.email);
  record(`profile-${info.project.name}.json`,{kind:'Real synthetic Auth with explicitly seeded Google metadata; image transport fault controlled, not Google OAuth',restrictedRequestCount:images.length,fallback:true,publicPreviewIsolated:true});
});

test('idle review over five minutes then fresh verification and retry',async({page,context},info)=>{
  test.skip(process.env.PALMSTEEZE_TARGETED_CONTROLLED!=='true','Controlled lifecycle checks are a separate evidence class');
  test.setTimeout(390000);
  await enter(page,context);await signIn(context);await controlledWidget(page);await page.goto(destination);
  await page.locator('label').filter({has:page.getByRole('radio',{name:/Custom amount/})}).click();await page.getByLabel('Payment amount in naira').fill('1000.01');
  expect(await page.locator('.security-widget button').count()).toBe(0);
  const started=Date.now();
  for(let minute=0;minute<6;minute++)await page.waitForTimeout(51000);
  const elapsed=Date.now()-started;expect(elapsed).toBeGreaterThan(300000);
  expect(await page.locator('.security-widget button').count()).toBe(0);
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
  let requests=0;await page.route('**/api/checkout',route=>{requests++;expect(Object.keys(route.request().postDataJSON())).toEqual(['resourceId','startsAt','endsAt','requestId','expectedQuote','amountKobo']);return route.fulfill({status:503,json:{error:'Controlled service fault. Retry safely.'}});});
  await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();await expect(page.getByRole('button',{name:'Controlled verify'})).toBeVisible();await capture(page,'idle-pending',info);
  await page.getByRole('button',{name:'Controlled verify'}).click();await expect(page.locator('.booking-status')).toHaveText('Controlled service fault. Retry safely.');
  await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
  await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();await expect(page.getByRole('button',{name:'Controlled verify'})).toBeVisible();await page.getByRole('button',{name:'Controlled verify'}).click();await expect(page.locator('.booking-status')).toHaveText('Controlled service fault. Retry safely.');
  expect(requests).toBe(2);
  const events=await page.evaluate(()=>(window as unknown as {widgetEvents:unknown[]}).widgetEvents);
  record(`idle-${info.project.name}.json`,{kind:'Controlled widget/API faults; actual wall-clock idle, no genuine provider claim',elapsedMs:elapsed,requests,events,choicesPreserved:true});
});

test('official test-key booking, stable helper, companion and genuine Stripe sandbox payment',async({page,context},info)=>{
  test.skip(process.env.PALMSTEEZE_TARGETED_CONTROLLED==='true','Provider flow runs separately with official test keys');test.setTimeout(180000);
  await enter(page,context);await signIn(context);await page.goto(destination);
  // Expire only this tab's entrance cookie. The inline renewal must retain
  // necessary-only inputs and never substitute for reserve verification.
  await page.locator('label').filter({has:page.getByRole('radio',{name:/Custom amount/})}).click();await page.getByLabel('Payment amount in naira').fill('1000.01');
  await context.clearCookies({name:'ps-clearance'});
  const tabs=context.pages().length;
  await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();
  await expect.poll(async()=> (await (await context.request.get('/api/verification')).json()).verified,{timeout:30000}).toBe(true);
  await expect(page.locator('.verification-renewal')).toHaveCount(0);
  expect(context.pages().length).toBe(tabs);expect(new URL(page.url()).pathname).toBe('/booking/review');await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
  const requests:{keys:string[];requestId:string}[]=[];
  page.on('request',request=>{if(request.url().endsWith('/api/checkout')){const data=request.postDataJSON();requests.push({keys:Object.keys(data),requestId:data.requestId});}});
  const submit=page.getByRole('button',{name:'Continue to test payment',exact:true});
  await submit.click();await expect(page).toHaveURL(/\/booking\/[0-9a-f-]+$/,{timeout:60000});
  const bookingId=new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('region',{name:'Sandbox test card'})).toBeVisible();
  const fields=async()=>page.locator('[data-card-field]').allTextContents();const first=await fields();
  const number=first[0].replaceAll(' ','');const definition=sandboxCards.find(card=>card.number===number);expect(definition).toBeTruthy();expect(first[2].length).toBe(definition!.cvcLength);expect(first[3]).toContain('Demo Visitor');
  expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
  await accessible(page);await capture(page,'sandbox-card',info);
  await page.reload();expect(await fields()).toEqual(first);
  if(info.project.name==='desktop') {
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    for(const [index,label] of ['card number','expiry','cvc','cardholder'].entries()) {await page.getByRole('button',{name:'Copy '+label,exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(index===0?number:first[index]);}
    const popupWait=page.waitForEvent('popup');await page.getByRole('button',{name:'Open card companion ↗',exact:true}).click();const companion=await popupWait;await companion.waitForURL(origin+'/booking/'+bookingId+'/test-card');await companion.locator('[data-card-field]').first().waitFor();expect(await companion.locator('[data-card-field]').allTextContents()).toEqual(first);expect(await companion.evaluate(()=>window.opener)).toBeNull();await capture(companion,'sandbox-companion',info);await companion.close();
    await page.evaluate(()=>{window.open=()=>null;});await page.getByRole('button',{name:'Open card companion ↗',exact:true}).click();await expect(page.locator('.sandbox-card-status')).toHaveText('Window blocked. Copy from the card here.');
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('controlled clipboard denial'))},configurable:true});});await page.getByRole('button',{name:'Copy cvc',exact:true}).click();await expect(page.locator('.sandbox-card-status')).toContainText('copy it manually');
  }
  const checkoutUrl=await page.getByRole('link',{name:'Continue to test payment',exact:true}).getAttribute('href');expect(new URL(checkoutUrl!).hostname).toBe('checkout.stripe.com');
  if(info.project.name==='desktop') {
    const key=process.env.STRIPE_SECRET_KEY||'';expect(/^(sk_test_|rk_test_|rkcs_test_)/.test(key)).toBe(true);
    const stripe=new Stripe(key,{maxNetworkRetries:1,timeout:15000});expect((await stripe.accounts.retrieveCurrent()).id).toBe(process.env.STRIPE_ACCOUNT_ID);
    await page.getByRole('link',{name:'Continue to test payment',exact:true}).click();await page.locator('#email').fill(user.email,{timeout:45000});await page.locator('#cardNumber').fill(number);await page.locator('#cardExpiry').fill(first[1].replace('/',''));await page.locator('#cardCvc').fill(first[2]);if(await page.locator('#billingName').isVisible())await page.locator('#billingName').fill(first[3]);if(await page.locator('#billingPostalCode').isVisible())await page.locator('#billingPostalCode').fill('10001');
    await capture(page,'hosted-stripe-ready',info);await page.locator('button[type=submit]').click();await page.waitForURL(origin+'/booking/'+bookingId+'?checkout=returned',{timeout:60000});
    await expect(page.locator('[data-testid=booking-state]')).toContainText('confirmed',{timeout:60000});await expect(page.locator('[data-testid=payment-state]')).toContainText('paid');
    const payment=(await db.query('select * from public.payment_attempts where booking_id=$1',[bookingId])).rows[0];
    const provider=await stripe.checkout.sessions.retrieve(payment.session_id,{expand:['payment_intent']});
    expect(provider.livemode).toBe(false);expect(provider.payment_status).toBe('paid');expect(provider.currency).toBe('ngn');expect(provider.amount_total).toBe(Number(payment.amount_kobo));
    const intent=provider.payment_intent as Stripe.PaymentIntent;expect(intent.status).toBe('succeeded');expect(intent.amount_received).toBe(Number(payment.collected_kobo));
    await capture(page,'sandbox-payment-confirmed',info);
    record(`stripe-payment-${info.project.name}.json`,{kind:'Genuine Stripe sandbox hosted payment; official Cloudflare test-key verification; synthetic seeded Google identity, not OAuth',bookingId,cardId:definition!.id,livemode:provider.livemode,status:provider.status,paymentStatus:provider.payment_status,currency:provider.currency,amountTotal:provider.amount_total,amountReceived:intent.amount_received,bookingState:'confirmed',providerSessionId:provider.id,paymentIntentId:intent.id});
  }
  expect(requests).toHaveLength(1);expect(requests[0].keys).toEqual(['resourceId','startsAt','endsAt','requestId','expectedQuote','amountKobo']);
  record(`card-flow-${info.project.name}.json`,{kind:'Official Cloudflare test keys, real synthetic Auth/database and real Stripe sandbox session',bookingId,cardId:definition!.id,stableAfterReload:true,necessaryOnly:true,inlineEntranceRenewalPreservedAmount:true,noNewTabRenewal:true,companionChecked:info.project.name==='desktop',reservationApiHasNoCardFields:true});
});

test('reservation endpoint and closed direct-RPC boundary remain independent',async({page,context},info)=>{
  await enter(page,context);await signIn(context);
  const {starts_at,ends_at}=intervalFromSelection(initialBookingDate(new Date(Date.now()+19*86400000)),11,1);
  const quoted=await (await context.request.get('/api/quote?'+new URLSearchParams({resource,start:starts_at,end:ends_at}))).json();
  const q=quoted.quote;const expectedQuote=JSON.stringify({hourly_kobo:q.hourly_kobo,total_kobo:q.total_kobo,deposit_percent:q.deposit_percent,deposit_kobo:q.deposit_kobo,balance_kobo:q.balance_kobo});
  const before=(await db.query('select count(*)::int n from public.bookings where owner_id=$1',[user.id])).rows[0].n;
  const denied=await context.request.post('/api/checkout',{headers:{Origin:origin},data:{resourceId:resource,startsAt:starts_at,endsAt:ends_at,requestId:randomUUID(),expectedQuote,amountKobo:String(q.deposit_kobo)}});expect(denied.status()).toBe(403);
  for(const field of ['pan','cvc','ownerId','role']){const invalid=await context.request.post('/api/checkout',{headers:{Origin:origin},data:{resourceId:resource,startsAt:starts_at,endsAt:ends_at,requestId:randomUUID(),expectedQuote,amountKobo:String(q.deposit_kobo),[field]:'controlled-invalid-field'}});expect(invalid.status()).toBe(400);}
  const old=await db.query("select p.proname,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') customer,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_hold','begin_checkout')");expect(old.rowCount).toBe(3);expect(old.rows.every(row=>!row.anon&&!row.customer&&!row.service)).toBe(true);
  expect((await db.query('select count(*)::int n from public.bookings where owner_id=$1',[user.id])).rows[0].n).toBe(before);
  record(`security-${info.project.name}.json`,{kind:'Real HTTP and read-only actual-role privilege inspection',clearanceDoesNotAuthorizeReservation:true,missingReserveTokenStatus:denied.status(),oldSignatures:old.rows,zeroRejectedReservationSideEffects:true});
});

test('explicit expiry, timeout, duplicate clicks and blocked-script recovery retain choices',async({page,context},info)=>{
  test.skip(process.env.PALMSTEEZE_TARGETED_CONTROLLED!=='true','Controlled lifecycle evidence only');
  await enter(page,context);await signIn(context);await controlledWidget(page);await page.goto(destination);
  await page.locator('label').filter({has:page.getByRole('radio',{name:/Custom amount/})}).click();await page.getByLabel('Payment amount in naira').fill('1000.01');
  let posts=0;await page.route('**/api/checkout',route=>{posts++;return route.fulfill({status:503,json:{error:'Controlled service fault.'}});});
  const submit=page.getByRole('button',{name:'Continue to test payment',exact:true});
  for(const [index,[event,message]] of [['expireLastWidget','Verification expired.'],['timeoutLastWidget','Verification timed out.']].entries()){
    await submit.click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {widgetEvents:{kind:string}[]}).widgetEvents?.filter(event=>event.kind==='execute').length||0)).toBe(index+1);await expect(page.getByRole('button',{name:'Controlled verify'})).toBeVisible();await expect(page.locator('button[aria-describedby=security-status]')).toBeDisabled();await page.locator('button[aria-describedby=security-status]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});expect(posts).toBe(0);
    await page.evaluate(event=>(window as unknown as Record<string,()=>void>)[event](),event);await expect(page.locator('.booking-status')).toContainText(message);await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
  }
  await submit.click();await page.getByRole('button',{name:'Controlled verify'}).click();await expect(page.locator('.booking-status')).toHaveText('Controlled service fault.');expect(posts).toBe(1);
  const events=await page.evaluate(()=>(window as unknown as {widgetEvents:{kind:string}[]}).widgetEvents);expect(events.filter(event=>event.kind==='render')).toHaveLength(1);expect(events.filter(event=>event.kind==='reset')).toHaveLength(2);
  await page.unroute('https://challenges.cloudflare.com/turnstile/v0/api.js*');await page.route('https://challenges.cloudflare.com/**',route=>route.abort());await page.reload();await page.locator('label').filter({has:page.getByRole('radio',{name:/Custom amount/})}).click();await page.getByLabel('Payment amount in naira').fill('1000.01');await submit.click();await expect(page.locator('.booking-status')).toContainText('could not load');await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
  await page.unroute('https://challenges.cloudflare.com/**');await controlledWidget(page);await submit.click();await page.getByRole('button',{name:'Controlled verify'}).click();await expect(page.locator('.booking-status')).toHaveText('Controlled service fault.');expect(posts).toBe(2);
  record(`lifecycle-${info.project.name}.json`,{kind:'Controlled widget, expiry, timeout, blocked-script and API faults',oneWidgetAcrossExplicitRetries:true,duplicateClicksPrevented:true,amountPreserved:true,scriptRetryRecovered:true,posts});
});

test('genuine reservation diagnostic after five-minute idle and explicit retry',async({page,context},info)=>{
  test.skip(process.env.PALMSTEEZE_TARGETED_GENUINE!=='true','Genuine provider diagnostics run only with the restored genuine-key build');test.setTimeout(450000);
  expect(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE).not.toBe('true');expect(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY).not.toMatch(/^[123]x0{10,}/);
  // Trusted test-issued entrance clearance isolates reserve; this cannot be
  // reported as a genuine entrance success. Auth and quote reads are real.
  await enter(page,context);await signIn(context);await page.goto(destination);
  await page.locator('label').filter({has:page.getByRole('radio',{name:/Custom amount/})}).click();await page.getByLabel('Payment amount in naira').fill('1000.01');
  const began=Date.now();for(let minute=0;minute<6;minute++)await page.waitForTimeout(51000);
  const elapsedMs=Date.now()-began;expect(elapsedMs).toBeGreaterThan(300000);expect(await page.locator('.security-widget iframe').count()).toBe(0);
  const results=[];let applicationRequests=0;page.on('request',request=>{if(request.url().endsWith('/api/checkout'))applicationRequests++;});
  for(let attempt=1;attempt<=2;attempt++){
    await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();
    await page.waitForTimeout(1800);await capture(page,'genuine-reserve-pending-'+attempt,info);
    const widget=page.locator('.security-widget');if(await widget.isVisible())await widget.click({position:{x:20,y:32}}).catch(()=>{});
    await expect.poll(async()=>new URL(page.url()).pathname!=='/booking/review'||(await page.locator('.reservation-security[data-action=reserve]').getAttribute('data-state'))==='error',{timeout:55000}).toBe(true);
    if(new URL(page.url()).pathname!=='/booking/review'){results.push({attempt,serverCreatedBooking:true});await capture(page,'genuine-reserve-created',info);break;}
    const frameBoundaries=[];
    for(const frame of page.frames().filter(frame=>{try{return new URL(frame.url()).hostname==='challenges.cloudflare.com';}catch{return false;}})){
      const text=await frame.locator('body').innerText({timeout:2000}).catch(()=>'');
      frameBoundaries.push({host:'challenges.cloudflare.com',newTabTextObserved:/new tab|new window/i.test(text),readable:!!text});
    }
    results.push({attempt,state:await page.locator('.reservation-security[data-action=reserve]').getAttribute('data-state'),code:await page.locator('.reservation-security[data-action=reserve]').getAttribute('data-error-code'),message:await page.locator('#security-status').innerText(),iframeBoundaries:frameBoundaries});
    await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');await capture(page,'genuine-reserve-result-'+attempt,info);
  }
  record(`genuine-reserve-${info.project.name}.json`,{kind:'Genuine configured Cloudflare reservation widget, no widget or Siteverify mocks; trusted test-issued entrance clearance only, synthetic seeded identity',ownerObservedEntranceSuccess:'separate owner report, not established by this run',elapsedMs,applicationRequests,results,physicalPhone:false,googleOAuth:false,applicationOwnedNewTabRecovery:false});
});

test('genuine widget network and iframe boundary diagnostic',async({page,context},info)=>{
  test.skip(process.env.PALMSTEEZE_TARGETED_GENUINE!=='true','Genuine network diagnostic only');test.setTimeout(80000);
  const network:{host:string;path:string;status?:number;failure?:string}[]=[],consoleCodes:string[]=[];
  page.on('response',response=>{const url=new URL(response.url());if(url.hostname==='challenges.cloudflare.com')network.push({host:url.hostname,path:url.pathname.replace(/\/[^/]{20,}/g,'/[redacted]'),status:response.status()});});
  page.on('requestfailed',request=>{const url=new URL(request.url());if(url.hostname==='challenges.cloudflare.com')network.push({host:url.hostname,path:url.pathname.replace(/\/[^/]{20,}/g,'/[redacted]'),failure:request.failure()?.errorText});});
  page.on('console',message=>{if(/turnstile|cloudflare/i.test(message.text()))consoleCodes.push(...message.text().match(/\b\d{6}\b/g)||[]);});
  await enter(page,context);await signIn(context);await page.goto(destination);await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();
  await expect.poll(async()=>new URL(page.url()).pathname!=='/booking/review'||await page.locator('.reservation-security[data-action=reserve]').getAttribute('data-state')==='error',{timeout:55000}).toBe(true);
  const frames=[];for(const frame of page.frames().filter(frame=>frame.url().includes('challenges.cloudflare.com'))){frames.push(await frame.evaluate(()=>({ready:document.readyState,bodyElements:document.body?.childElementCount,readableText:!!document.body?.innerText,newTabText:/new tab|new window/i.test(document.body?.innerText||'')})).catch(()=>({unavailable:true})));}
  await capture(page,'genuine-network-result',info);
  record(`genuine-network-${info.project.name}.json`,{kind:'Genuine configured provider network/iframe read-only diagnosis; no frame modification or provider simulation',network,consoleCodes,frames,applicationNewTabLinks:await page.locator('main a[target=_blank]').count(),resultMessage:await page.locator('#security-status').innerText().catch(()=>'Navigated after verification')});
});

test('official forced-interaction horizontal widget',async({page,context},info)=>{
  test.skip(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!=='3x00000000000000000000FF','Official force-interaction test key only');
  await enter(page,context);await signIn(context);await page.goto(destination);
  await page.route('**/api/checkout',route=>route.fulfill({status:503,json:{error:'Controlled post-verification service fault.'}}));
  await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();await expect(page.locator('.reservation-security[data-action=reserve]')).toHaveAttribute('data-state','challenge',{timeout:30000});
  const frame=page.frames().find(frame=>frame.url().includes('challenges.cloudflare.com'));expect(frame).toBeTruthy();const box=await (await frame!.frameElement()).boundingBox();expect(box!.width).toBeGreaterThanOrEqual(300);expect(box!.height).toBe(65);
  await capture(page,'official-interactive-horizontal',info);await page.locator('.security-widget').click({position:{x:20,y:32}});await expect(page.locator('.booking-status')).toHaveText('Controlled post-verification service fault.',{timeout:30000});
  record(`interactive-${info.project.name}.json`,{kind:'Official forced-interaction dummy widget; post-verification API fault controlled, no genuine pass claim',horizontalOfficialFrame:box,userCheckboxCompleted:true});
});
