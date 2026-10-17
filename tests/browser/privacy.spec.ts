import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Client} from 'pg';
import {verifyProject,connectDatabase} from '../../scripts/lib/database';
import {initialBookingDate,intervalFromSelection} from '../../src/lib/domain';
import {visitDestination} from '../../src/lib/auth/destinations';
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
test.describe.configure({mode:'serial',timeout:90000});
const origin='http://localhost:3000',headers={Origin:origin};
const evidence='docs/evidence/m4-entrance/reservation',screens='docs/screenshots/m4-entrance/reservation';
let database:Client;let user:{id:string;email:string;password:string};let resource:string;
let auth:ReturnType<typeof createClient>;
let selection:{resource:string;date:string;hour:number;duration:number};
async function signIn(context:BrowserContext) {
  const jar=new Map<string,string>();
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))}});
  const result=await client.auth.signInWithPassword({email:user.email,password:user.password});
  if(result.error||!result.data.session) throw new Error('Isolated fixture sign-in failed; values withheld');
  await context.addCookies([...jar].filter(([,value])=>value).map(([name,value])=>({name,value,url:origin,httpOnly:true,sameSite:'Lax' as const,secure:false})));
}
async function capture(page:Page,name:string) {
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(image=>image.complete||image.loading!=='lazy').map(image=>image.decode().catch(()=>{})));});
  await page.screenshot({path:`${screens}/${name}.png`,fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden}'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(item=>item.id)).toEqual([]);
}
async function mockWidget(page:Page) {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={render:(node,options)=>{window.proofOptions=options;node.textContent='Controlled security widget';options.callback('controlled-pass-'+crypto.randomUUID());return 'fixture';},remove:()=>{}};`}));
}
test.beforeAll(async()=>{
  mkdirSync(evidence,{recursive:true});mkdirSync(screens,{recursive:true});await verifyProject();database=await connectDatabase();
  auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`privacy-${randomUUID()}@palmsteeze.invalid`,password=randomBytes(32).toString('base64url');
  const created=await auth.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user) throw new Error('Fixture creation failed; values withheld');
  user={id:created.data.user.id,email,password};resource=(await database.query("select id from public.resources where code='OPEN-12'")).rows[0].id;
  selection={resource,date:initialBookingDate(new Date(Date.now()+8*86400000)),hour:10,duration:1};
});
test.beforeEach(async({context})=>{
  // Controlled entrance only; reserve-action tokens still have independent tests.
  expect((await context.request.post('/api/verification',{headers,data:{token:'controlled-entrance-'+randomUUID(),next:'/'}})).status()).toBe(200);
  expect((await context.request.post('/api/preferences',{headers,data:{optional:false}})).status()).toBe(200);
});
test.afterAll(async()=>{
  if(!database) return;
  try {if(user) {
    const unsafe=await database.query("select count(*)::int n from public.payment_attempts where owner_id=$1 and (collected_kobo<>0 or state not in ('expired','creation_failed'))",[user.id]);
    if(unsafe.rows[0].n) throw new Error('Unresolved fixture payment retained for safe recovery');
    await database.query('begin');
    await database.query('delete from public.admin_audit where target_id in(select id from public.bookings where owner_id=$1)',[user.id]);
    await database.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=$1)',[user.id]);
    await database.query('delete from public.refund_operations where attempt_id in(select id from public.payment_attempts where owner_id=$1)',[user.id]);
    await database.query('delete from public.payment_attempts where owner_id=$1',[user.id]);
    await database.query('delete from public.allocations where booking_id in (select id from public.bookings where owner_id=$1)',[user.id]);await database.query('delete from public.bookings where owner_id=$1',[user.id]);await database.query('commit');
    if((await auth.auth.admin.deleteUser(user.id)).error) throw new Error('Fixture cleanup failed');
  }} finally {await database.end();}
});
test('policy navigation, narrow layouts, storage, reduced motion and preview isolation',async({page,context},info)=>{
  const hosts=new Set<string>();page.on('request',request=>hosts.add(new URL(request.url()).hostname));
  for(const route of ['/privacy','/cookies','/terms','/login','/preview/admin']) {
    await page.goto(route);await expect(page.locator('main h1')).toBeVisible();
    if(route==='/cookies') await expect(page.locator('main')).toContainText('cf.turnstile.u');
    for(const name of ['Privacy','Cookies','Demo Terms']) await expect(page.getByRole('navigation',{name:'Footer navigation'}).getByRole('link',{name,exact:true})).toBeVisible();
    await capture(page,`${route.slice(1).replaceAll('/','-')}-${info.project.name}`);
  }
  await page.setViewportSize({width:320,height:800});await page.goto('/privacy');await capture(page,`privacy-narrow-${info.project.name}`);
  await page.getByRole('navigation',{name:'On this page'}).getByRole('link',{name:'Your choices & rights'}).click();await expect(page).toHaveURL(/#rights$/);
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.locator('.workspace-experience')).toHaveAttribute('data-motion','reduced');
  await page.getByRole('link',{name:'Skip to content'}).focus();await page.keyboard.press('Enter');await expect(page.locator('main')).toBeFocused();
  await page.getByLabel('Your space',{exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByLabel('Your space',{exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Date',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Date',exact:true})).toBeFocused();
  const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
  const cookies=(await context.cookies()).map(({name,expires,httpOnly,sameSite,secure})=>({name,expires,httpOnly,sameSite,secure}));
  expect(storage.local).toEqual([]);expect(hosts.has('challenges.cloudflare.com')).toBe(false);
  expect(storage.session).toEqual([]);
  await expect(page.getByRole('checkbox',{name:'Remember my choices in this tab'})).toHaveCount(0);
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();
  await page.getByRole('checkbox',{name:/Remember booking/}).check();await page.getByRole('button',{name:'Save preferences'}).click();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('palmsteeze.visit.v1'))).not.toBeNull();
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.getByRole('button',{name:'Necessary only',exact:true}).click();expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
  writeFileSync(`${evidence}/public-storage-${info.project.name}.json`,JSON.stringify({kind:'observed-browser',hosts:[...hosts],storage,cookies},null,2));
});
test('protected endpoints reject faults before side effects and safely deduplicate verified retries',async({context},info)=>{
  await signIn(context);const interval=intervalFromSelection(selection.date,selection.hour,selection.duration);
  const q=(await (await context.request.get(`/api/quote?${new URLSearchParams({resource,start:interval.starts_at,end:interval.ends_at})}`)).json()).quote;
  const expectedQuote=JSON.stringify({hourly_kobo:q.hourly_kobo,total_kobo:q.total_kobo,deposit_percent:q.deposit_percent,deposit_kobo:q.deposit_kobo,balance_kobo:q.balance_kobo});
  const payload={resourceId:resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID()};
  const counts=async()=> (await database.query(`select (select count(*) from public.bookings where owner_id=$1)::int bookings,(select count(*) from public.payment_attempts where owner_id=$1)::int payments,(select count(*) from private.payment_jobs j join public.payment_attempts a on a.id=j.attempt_id where a.owner_id=$1)::int jobs`,[user.id])).rows[0];
  const before=await counts();const results=[];
  for(const endpoint of ['/api/holds','/api/checkout']) for(const [token,status] of [['',403],['controlled-invalid',403],['controlled-expired',403],['controlled-hostname',403],['controlled-action',403],['controlled-old',403],['controlled-provider',503],['controlled-timeout',503]] as const) {
    const response=await context.request.post(endpoint,{headers:{...headers,'X-Turnstile-Token':token},data:{...payload,...(endpoint==='/api/checkout'?{expectedQuote}: {})}});
    expect(response.status()).toBe(status);expect((await response.json()).securityCheck).toBe(true);expect(await counts()).toEqual(before);results.push({endpoint,scenario:token||'missing',status,sideEffects:0});
  }
  const accepted=await context.request.post('/api/holds',{headers:{...headers,'X-Turnstile-Token':`controlled-pass-${info.project.name}`},data:payload});expect(accepted.status()).toBe(201);const booking=(await accepted.json()).booking;
  const replay=await context.request.post('/api/holds',{headers:{...headers,'X-Turnstile-Token':`controlled-pass-${info.project.name}`},data:{...payload,requestId:randomUUID()}});expect(replay.status()).toBe(403);
  const retry=await context.request.post('/api/holds',{headers:{...headers,'X-Turnstile-Token':`controlled-pass-retry-${info.project.name}`},data:payload});expect(retry.status()).toBe(201);expect((await retry.json()).booking.id).toBe(booking.id);expect((await counts()).bookings).toBe(before.bookings+1);
  expect((await context.request.delete(`/api/holds/${booking.id}`,{headers})).status()).toBe(204);
  const checkoutPayload={...payload,requestId:randomUUID(),expectedQuote};
  const checkouts=await Promise.all(['a','b'].map(suffix=>context.request.post('/api/checkout',{headers:{...headers,'X-Turnstile-Token':`controlled-pass-checkout-${info.project.name}-${suffix}`},data:checkoutPayload})));
  for(const response of checkouts) expect([201,202]).toContain(response.status());
  const details=await Promise.all(checkouts.map(response=>response.json()));expect(details[0].booking.id).toBe(details[1].booking.id);expect(details[0].payment.id).toBe(details[1].payment.id);
  expect((await counts()).payments).toBe(before.payments+1);expect((await counts()).jobs).toBe(before.jobs+1);
  const stopped=await context.request.delete(`/api/bookings/${details[0].booking.id}/checkout`,{headers});expect(stopped.status()).toBe(200);expect((await stopped.json()).payment.state).toBe('expired');
  writeFileSync(`${evidence}/endpoints-${info.project.name}.json`,JSON.stringify({kind:'controlled-Siteverify-real-Auth-PostgreSQL-Stripe-sandbox',results,replayStatus:403,retrySameBooking:true,concurrentCheckoutSameBookingAndAttempt:true,checkoutSafelyExpired:true},null,2));
});
test('security expiry, blocked script and retry preserve payment choices',async({page,context},info)=>{
  await signIn(context);await context.request.post('/api/preferences',{headers,data:{optional:true}});await mockWidget(page);await page.goto(visitDestination(selection));await expect(page.locator('#security-status')).toContainText('complete');
  await page.getByRole('radio',{name:/Custom amount/}).check();await page.getByLabel('Payment amount in naira').fill('1000.01');
  await page.evaluate(()=>{(window as unknown as {proofOptions:Record<string,()=>void>}).proofOptions['expired-callback']();});await expect(page.locator('#security-status')).toContainText('expired');await page.getByRole('button',{name:'Continue to test payment'}).click();await expect(page.locator('.booking-status')).toContainText('Complete the security check');await capture(page,`security-expired-${info.project.name}`);
  await page.getByRole('button',{name:'Retry security check'}).click();await expect(page.locator('#security-status')).toContainText('complete');await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');await capture(page,`security-ready-controlled-${info.project.name}`);
  const repriced=page.waitForResponse(response=>response.url().includes('/api/quote?'));
  const recheck=page.getByRole('button',{name:'Recheck price & availability'});
  if(info.project.name==='mobile') await recheck.tap();else await recheck.click();
  expect((await repriced).status()).toBe(200);await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
  await page.route('**/api/checkout',route=>route.fulfill({status:503,json:{error:'Security verification could not be reached. Retry the security check; your visit choices are saved.',securityCheck:true}}));await page.getByRole('button',{name:'Continue to test payment'}).click();await expect(page.locator('.booking-status')).toContainText('could not be reached');await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
  await page.unroute('https://challenges.cloudflare.com/turnstile/v0/api.js*');await page.route('https://challenges.cloudflare.com/**',route=>route.abort());await page.reload();await expect(page.locator('#security-status')).toContainText('could not load');await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');await capture(page,`security-blocked-${info.project.name}`);
});
test('genuine local widget and Siteverify results are distinct from controlled tests',async({page,context},info)=>{
  const network:{host:string;status?:number;failure?:string}[]=[];
  page.on('response',response=>{if(new URL(response.url()).hostname==='challenges.cloudflare.com') network.push({host:'challenges.cloudflare.com',status:response.status()});});
  page.on('requestfailed',request=>{if(new URL(request.url()).hostname==='challenges.cloudflare.com') network.push({host:'challenges.cloudflare.com',failure:request.failure()?.errorText});});
  await signIn(context);await page.goto(visitDestination(selection));await page.getByRole('region',{name:'Reservation security'}).scrollIntoViewIfNeeded();let completed=false;
  try{await expect.poll(()=>page.frames().filter(frame=>frame.url().startsWith('https://challenges.cloudflare.com/')).length,{timeout:10000}).toBeGreaterThan(0);await page.locator('.security-widget').click({position:{x:20,y:32}});}catch{/* Normal widget interaction only; record provider limits. */}
  try {await expect(page.locator('#security-status')).toContainText('complete',{timeout:45000});completed=true;} catch { /* Record provider challenge limits without relabelling them as success. */ }
  const report:Record<string,unknown>={kind:'genuine-local-widget',completed,verification:'not attempted',ownerTesting:false,network};
  if(completed) {
    const token=await page.evaluate(()=> (window.turnstile as unknown as {getResponse:()=>string}).getResponse());
    const interval=intervalFromSelection(selection.date,13,1),payload={resourceId:resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID()};
    const response=await context.request.post('/api/holds',{headers:{...headers,'X-Turnstile-Token':token},data:payload});report.verificationStatus=response.status();report.verification=response.status()===201?'passed':'failed';
    if(response.status()===201) {const id=(await response.json()).booking.id;const replay=await context.request.post('/api/holds',{headers:{...headers,'X-Turnstile-Token':token},data:payload});report.replayStatus=replay.status();expect(replay.status()).toBe(403);expect((await context.request.delete(`/api/holds/${id}`,{headers})).status()).toBe(204);}
  }
  report.storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));report.cookies=(await context.cookies()).map(({name,expires,httpOnly,sameSite,secure})=>({name,expires,httpOnly,sameSite,secure}));report.message=await page.locator('#security-status').innerText();
  report.widget=await page.locator('.security-widget').evaluate(node=>({children:node.children.length,iframe:!!node.querySelector('iframe'),apiPresent:!!window.turnstile}));
  report.storageOrigins=(await context.storageState()).origins.map(item=>({origin:item.origin,localStorageKeys:item.localStorage.map(entry=>entry.name)}));
  writeFileSync(`${evidence}/genuine-widget-${info.project.name}.json`,JSON.stringify(report,null,2));await capture(page,`genuine-widget-${info.project.name}`);
});
