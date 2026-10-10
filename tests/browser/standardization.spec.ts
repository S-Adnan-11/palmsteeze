import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Client} from 'pg';
import {connectDatabase,inspectDatabase} from '../../scripts/lib/database';
import {initialBookingDate,intervalFromSelection} from '../../src/lib/domain';
import {visitDestination} from '../../src/lib/auth/destinations';
import {createClearance} from '../../src/lib/security-sessions';
import {chooseDate} from './choose-date';
import {selectChoice} from './select-choice';

const origin='http://localhost:3000',screens='docs/screenshots/m4-standardization',evidence='docs/evidence/m4-standardization';
test.use({baseURL:origin,trace:'off',screenshot:'off',video:{mode:'on'}});
test.describe.configure({timeout:90000});
let db:Client,admin:ReturnType<typeof createClient>,user:{id:string;email:string;password:string},resource:string,destination:string;
test.beforeAll(async()=>{
  expect(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE).toBe('true');
  mkdirSync(screens,{recursive:true});mkdirSync(evidence,{recursive:true});mkdirSync('docs/recordings/m4-standardization',{recursive:true});
  db=await connectDatabase();await inspectDatabase(db);
  admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`visual-${randomUUID()}@palmsteeze.invalid`,password=randomBytes(32).toString('base64url');
  const made=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Demo visitor'}});
  if(made.error||!made.data.user)throw new Error('Synthetic Auth setup failed; response withheld.');
  user={id:made.data.user.id,email,password};
  resource=(await db.query("select id from public.resources where code='OPEN-15'")).rows[0].id;
  destination=visitDestination({resource,date:initialBookingDate(new Date(Date.now()+19*86400000)),hour:11,duration:1});
});
test.afterAll(async()=>{
  if(!db)return;
  try {
    if(user) {
      expect((await db.query('select count(*)::int n from public.bookings where owner_id=$1',[user.id])).rows[0].n).toBe(0);
      expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull();
    }
  } finally {await db.end();}
});
async function signIn(context:BrowserContext) {
  const jar=new Map<string,string>();
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
  expect((await client.auth.signInWithPassword({email:user.email,password:user.password})).error).toBeNull();
  expect((await client.auth.getUser()).data.user?.id).toBe(user.id);
  await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:origin,httpOnly:true,sameSite:'Lax' as const})));
}
async function enter(page:Page) {
  await page.goto('/verify?next=/');await expect(page).toHaveURL(origin+'/',{timeout:30000});
}
async function settle(page:Page) {
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.loading!=='lazy').map(i=>i.decode().catch(()=>{})));});
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
}
async function capture(page:Page,name:string,mode:string,fullPage=false) {
  await settle(page);
  if(fullPage)await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  if(audit.violations.length)writeFileSync(`${evidence}/capture-errors-${name}-${mode}.json`,JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),null,2));
  await page.screenshot({path:`${screens}/after-${name}-${mode}.png`,fullPage,animations:'disabled'});
  expect(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))).toEqual([]);
}

test.describe('official test-key visitor recording',()=>{
  test('entrance automatically continues, then cookie choice and pointer/keyboard booking controls',async({page,context},info)=>{
    // Delay only the real request's transport so the official provider is visible
    // in the recording; this never replaces a token or Siteverify result.
    let releaseVerification!:()=>void;
    const verificationTransport=new Promise<void>(resolve=>{releaseVerification=resolve;});
    await page.route('**/api/verification',async route=>{
      if(route.request().method()==='POST')await verificationTransport;
      await route.continue();
    });
    await page.goto('/verify?next='+encodeURIComponent('/?date='+initialBookingDate(new Date(Date.now()+19*86400000))+'#plan'));
    await expect(page.locator('.security-widget')).toBeVisible();
    expect(await page.locator('h1').evaluate(n=>n===document.activeElement)).toBe(false);
    await expect(page.getByRole('button',{name:/Restart|Retry/})).toHaveCount(0);
    await capture(page,'entrance',info.project.name);
    releaseVerification();
    await expect(page).toHaveURL(/\/#plan$|\?date=[\d-]+#plan$/,{timeout:30000});
    expect((await (await context.request.get('/api/verification')).json()).verified).toBe(true);
    await expect(page.getByRole('link',{name:'Continue to PalmSteeze'})).toHaveCount(0);
    const banner=page.getByRole('region',{name:'Cookies and preferences'});await expect(banner).toBeVisible();
    expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toMatch(/^H[1-6]$/);
    expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await capture(page,'cookies',info.project.name);
    await page.getByRole('button',{name:'Necessary only',exact:true}).focus();await page.keyboard.press('Enter');await expect(banner).toHaveCount(0);
    await page.locator('#plan').scrollIntoViewIfNeeded();await capture(page,'planner',info.project.name);
    const space=page.getByLabel('Your space',{exact:true});await space.focus();await page.keyboard.press('ArrowDown');await capture(page,'dropdown',info.project.name);
    await page.keyboard.press('Escape');await expect(space).toBeFocused();
    expect(await space.evaluate(n=>getComputedStyle(n).outlineStyle)).toBe('solid');
    expect(await space.locator('.ui-icon').count()).toBe(1);
    await page.getByRole('button',{name:'Date',exact:true}).click();await capture(page,'calendar',info.project.name);
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Date',exact:true})).toBeFocused();
    await chooseDate(page,initialBookingDate(new Date(Date.now()+18*86400000)));
    await selectChoice(page,'Start time · WAT','11');await selectChoice(page,'Duration','2');
    await page.getByRole('button',{name:'Check availability',exact:true}).click();await expect(page.locator('.planner-summary .booking-status')).toContainText('Available when checked');
    expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
    writeFileSync(`${evidence}/visitor-${info.project.name}.json`,JSON.stringify({kind:'official Cloudflare test keys; real Siteverify and signed clearance cookie',automaticContinuation:true,cookieChoice:'necessary-only',optionalDraftsAbsent:true,pointerAndKeyboard:true,genuineWidgetSuccess:false,ownerAcceptance:false,physicalPhone:false},null,2));
    const video=page.video();await page.close();await video?.saveAs(`docs/recordings/m4-standardization/visitor-test-keys-${info.project.name}.webm`);
  });
});

test('review keeps exact amounts, independent reserve check, authentication and concise errors',async({page,context},info)=>{
  await enter(page);await page.getByRole('button',{name:'Necessary only',exact:true}).click();
  await page.goto(destination);await expect(page).toHaveURL(/\/login\?message=booking-required/);await capture(page,'signin',info.project.name,true);
  expect(await page.locator('input[name=next]').inputValue()).toBe(destination);
  await signIn(context);await page.goto(destination);await expect(page.locator('#security-status')).toHaveText('Security check complete.',{timeout:30000});
  await page.locator('.security-widget').scrollIntoViewIfNeeded();await capture(page,'review',info.project.name,true);
  const widget=page.locator('.security-widget');expect(await widget.evaluate(n=>n.getBoundingClientRect().width)).toBeGreaterThanOrEqual(300);
  await expect(page.getByRole('button',{name:'Restart security check'})).toHaveCount(0);
  const customAmount=page.getByRole('radio',{name:/Custom amount/});
  await page.locator('label').filter({has:customAmount}).click();await expect(customAmount).toBeChecked();
  await page.getByLabel('Payment amount in naira').fill('799.99');await expect(page.getByRole('button',{name:'Continue to test payment'})).toBeDisabled();await capture(page,'payment-invalid',info.project.name);
  await page.getByLabel('Payment amount in naira').fill('1000.01');await expect(page.getByRole('button',{name:'Continue to test payment'})).toBeEnabled();
  await expect(page.locator('.pay-now-summary')).toContainText('₦1,000.01');await expect(page.locator('.pay-now-summary')).toContainText('₦999.99');
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await expect(page.getByRole('checkbox',{name:/Remember booking/})).not.toBeChecked();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Cookie settings',exact:true})).toBeFocused();
  await page.route('**/api/checkout',route=>route.fulfill({status:503,json:{error:'Verification unavailable. Retry the check.'}}));
  await page.getByRole('button',{name:'Continue to test payment'}).click();await expect(page.locator('.booking-status')).toHaveText('Verification unavailable. Retry the check.');await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');await capture(page,'checkout-error',info.project.name);
  await page.unroute('**/api/checkout');
  const {starts_at,ends_at}=intervalFromSelection(initialBookingDate(new Date(Date.now()+19*86400000)),11,1);
  const query=new URLSearchParams({resource,start:starts_at,end:ends_at});
  const priced=await (await context.request.get('/api/quote?'+query)).json();
  const q=priced.quote;
  const expectedQuote=JSON.stringify({hourly_kobo:q.hourly_kobo,total_kobo:q.total_kobo,deposit_percent:q.deposit_percent,deposit_kobo:q.deposit_kobo,balance_kobo:q.balance_kobo});
  const noToken=await context.request.post('/api/checkout',{headers:{Origin:origin},data:{resourceId:resource,startsAt:starts_at,endsAt:ends_at,requestId:randomUUID(),amountKobo:'100001',expectedQuote}});expect(noToken.status()).toBe(403);
  await page.setViewportSize({width:320,height:800});await capture(page,'review-320',info.project.name,true);expect(await widget.evaluate(n=>n.getBoundingClientRect().width)).toBeGreaterThanOrEqual(300);
  await page.goto('/account');await capture(page,'history',info.project.name,true);await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/login/);
});

test('compact preferences preserve rejection, acceptance, withdrawal and dialog focus',async({page},info)=>{
  await enter(page);await page.getByRole('button',{name:'Manage preferences'}).click();await expect(page.getByRole('button',{name:'Close cookie settings'})).toBeFocused();await expect(page.getByRole('checkbox',{name:/Remember booking/})).not.toBeChecked();await capture(page,'preferences',info.project.name);
  await page.keyboard.press('Shift+Tab');expect(await page.getByRole('dialog').evaluate(n=>n.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Manage preferences'})).toBeFocused();
  await page.getByRole('button',{name:'Accept optional storage'}).click();await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('palmsteeze.visit.v1'))).not.toBeNull();
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.getByRole('button',{name:'Necessary only',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);await expect(page.getByRole('button',{name:'Cookie settings',exact:true})).toBeFocused();
  await page.goto('/preview/admin');await page.getByRole('button',{name:'Bookings',exact:true}).click();await page.getByRole('combobox',{name:'Booking status filter'}).focus();await page.keyboard.press('ArrowDown');await capture(page,'admin-dropdown',info.project.name);await page.keyboard.press('Escape');await expect(page.getByRole('combobox',{name:'Booking status filter'})).toBeFocused();await capture(page,'admin',info.project.name,true);
});

test('server failure, blocked cookie and actual stalled navigation stay separate',async({page,context},info)=>{
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={render:(node,options)=>{window.proofOptions=options;node.innerHTML='<button>Complete controlled check</button>';node.firstChild.onclick=()=>options.callback('controlled-entrance-'+crypto.randomUUID());return 'fixture';},remove:()=>{}};`}));
  await page.goto('/verify?next='+encodeURIComponent('/?proof=destination#plan'));
  await page.route('**/api/verification',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Verification unavailable. Try again.'}}):route.continue());
  await page.getByRole('button',{name:'Complete controlled check'}).click();await expect(page.locator('.entrance-result')).toHaveText('Verification unavailable. Try again.');await expect(page.getByRole('link',{name:'Continue to PalmSteeze'})).toHaveCount(0);expect((await context.cookies()).some(c=>c.name==='ps-clearance')).toBe(false);await capture(page,'entrance-server-error',info.project.name);
  await page.unroute('**/api/verification');
  await page.route('**/api/verification',route=>route.request().method()==='GET'?route.fulfill({json:{verified:false}}):route.continue());
  await page.getByRole('button',{name:'Retry verification',exact:true}).click();await page.getByRole('button',{name:'Complete controlled check'}).click();await expect(page.locator('.entrance-result')).toContainText('Allow first-party cookies');await expect(page.getByRole('link',{name:'Continue to PalmSteeze'})).toHaveCount(0);
  await page.unroute('**/api/verification');await context.clearCookies({name:'ps-clearance'});
  let release!:()=>void;const stalled=new Promise<void>(resolve=>{release=resolve;});
  await page.route(origin+'/?proof=destination',async route=>{await stalled;await route.continue().catch(()=>{});});
  // Cancel the actual outgoing document request, as with the browser Stop action.
  // Verification and its cookie still complete through the real server boundary.
  const cdp=await context.newCDPSession(page);
  const outgoing=page.waitForRequest(request=>request.isNavigationRequest()&&request.url()===origin+'/?proof=destination');
  try {
    await page.getByRole('button',{name:'Retry verification',exact:true}).click();await page.getByRole('button',{name:'Complete controlled check'}).click();
    await outgoing;await cdp.send('Page.stopLoading');release();
    await expect(page.locator('.entrance-result')).toHaveText('Opening your page…');
    await expect(page.getByRole('link',{name:'Continue to PalmSteeze'})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'Continue to PalmSteeze'})).toHaveAttribute('href','/?proof=destination#plan',{timeout:12000});
    await capture(page,'navigation-fallback',info.project.name);
    writeFileSync(`${evidence}/navigation-fallback-${info.project.name}.json`,JSON.stringify({kind:'controlled provider; actual outgoing document request cancelled with browser Stop',verifiedBeforeNavigation:true,manualLinkInitiallyAbsent:true,manualLinkAppearsAfterFailure:true,target:'/?proof=destination#plan'},null,2));
  } finally {release();}
  await page.unroute(origin+'/?proof=destination');await page.getByRole('link',{name:'Continue to PalmSteeze'}).click();await expect(page).toHaveURL(origin+'/?proof=destination#plan');
  const video=page.video();await page.close();await video?.saveAs(`docs/recordings/m4-standardization/navigation-controlled-${info.project.name}.webm`);
});

test('closed RPC permissions and guarded reservations reject entrance clearance and forged grants',async({context},info)=>{
  expect((await context.cookies()).length).toBe(0);
  const signatures=[
    'public.create_hold(uuid,timestamp with time zone,timestamp with time zone,uuid)',
    'public.begin_checkout(uuid,timestamp with time zone,timestamp with time zone,uuid,jsonb)',
    'public.begin_checkout(uuid,timestamp with time zone,timestamp with time zone,uuid,jsonb,bigint)',
  ];
  const checks=[];
  for(const role of ['anon','authenticated','service_role'])for(const signature of signatures) {
    expect((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed).toBe(false);
    checks.push({role,entry:signature.split('(')[0],execute:false});
  }
  const peers=await Promise.all([connectDatabase(),connectDatabase()]);
  try {
    expect((await peers[0].query('select pg_backend_pid() id')).rows[0].id).not.toBe((await peers[1].query('select pg_backend_pid() id')).rows[0].id);
    await Promise.all(peers.map(async(peer,index)=>{
      await peer.query('begin read only');
      try {
        await peer.query('set local role authenticated');
        await peer.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:user.id})]);
        expect((await peer.query('select current_user r')).rows[0].r).toBe('authenticated');
        const interval=intervalFromSelection(initialBookingDate(new Date(Date.now()+19*86400000)),11,1);
        await expect(peer.query('select public.create_verified_hold($1,$2,$3,$4,$5)',[resource,interval.starts_at,interval.ends_at,randomUUID(),index===0?'forged.clearance':createClearance(process.env)])).rejects.toMatchObject({code:'42501'});
      } finally {await peer.query('rollback');}
    }));
    checks.push({guardedEntry:'create_verified_hold',independentAuthenticatedConnections:2,forgedGrantDenied:true});
    writeFileSync(`${evidence}/rpc-permissions-${info.project.name}.json`,JSON.stringify({kind:'read-only role/permission regression; no schema change or provider call',checks},null,2));
  } finally {await Promise.all(peers.map(peer=>peer.end()));}
});
