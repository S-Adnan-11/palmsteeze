import {ensureEntrance,reservationHeaders,waitForReservationSecurity} from './reservation-security';
import { test,expect,type BrowserContext } from '@playwright/test';
import { createClient,type Session } from '@supabase/supabase-js';
import { createServerClient,createChunks } from '@supabase/ssr';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { verifyProject,connectDatabase,inspectDatabase } from '../../scripts/lib/database';
import { initialBookingDate,intervalFromSelection } from '../../src/lib/domain';
import { visitDestination } from '../../src/lib/auth/destinations';
import {selectChoice} from './select-choice';
import {chooseDate} from './choose-date';
import {formatVisitDate} from '../../src/lib/visit-dates';

// Genuine password-sign-in fixtures exercise SSR sessions. They are not Google OAuth proof.
// No auth tokens/cookies/requests are written to traces, videos, screenshots or console.
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
test.describe.configure({mode:'serial',timeout:90000});
test.beforeEach(async({context})=>{await ensureEntrance(context);});
const origin = 'http://localhost:3000';
type Identity = {id:string;email:string;password:string};
let owner:Client;
const users:Identity[] = [];
let resource:string;
let secretClient:ReturnType<typeof createClient>;
let destination:string;
let selection:{resource:string;date:string;hour:number;duration:number};
const headers = {Origin:origin};
const cookieName = () => `sb-${process.env.SUPABASE_PROJECT_REF}-auth-token`;

function sessionCookies(session:Session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  return createChunks(cookieName(),value).map((cookie) => ({...cookie,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const}));
}
async function signIn(context:BrowserContext,user:Identity) {
  const cookies = new Map<string,string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{
    getAll:() => [...cookies].map(([name,value]) => ({name,value})),
    setAll:(values) => values.forEach(({name,value}) => cookies.set(name,value)),
  }});
  const result = await client.auth.signInWithPassword({email:user.email,password:user.password});
  if (result.error || !result.data.session) throw new Error('Legitimate fixture sign-in failed; provider response withheld.');
  const verified = await client.auth.getUser();
  if (verified.error || verified.data.user?.id !== user.id) throw new Error('Fixture identity verification failed.');
  await context.addCookies([...cookies].filter(([,value]) => value).map(([name,value]) => ({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
  return result.data.session;
}
function assertPrivate(response:{headers:() => Record<string,string>},html = false) {
  const value = response.headers();expect(value['cache-control']).toContain('private');expect(value['cache-control']).toContain('no-store');
  expect(value['cache-control']).toContain('max-age=0');expect(value['cache-control']).toContain('must-revalidate');
  // Next owns Vary for App Router HTML/RSC. No-store prevents caching regardless of Vary.
  // JSON/auth route responses additionally retain explicit identity-variation headers.
  if (!html) {expect(value.vary.toLowerCase()).toContain('cookie');expect(value.vary.toLowerCase()).toContain('authorization');}
}

test.beforeAll(async () => {
  await verifyProject();owner = await connectDatabase();await inspectDatabase(owner);
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Fill SUPABASE_SECRET_KEY privately in .env.local.');
  secretClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  for (let i=0;i<2;i++) {
    const email = `m2a-${randomUUID()}@palmsteeze.invalid`;const password = randomBytes(32).toString('base64url');
    const result = await secretClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin'}});
    if (result.error || !result.data.user) throw new Error('Auth fixture creation failed; provider response withheld.');
    users.push({id:result.data.user.id,email,password});
  }
  const row = await owner.query("select id from public.resources where code='OPEN-12'");resource = row.rows[0].id;
  selection = {resource,date:initialBookingDate(new Date(Date.now()+7*86400000)),hour:10,duration:2};
  destination = visitDestination(selection);
});
test.afterAll(async () => {
  if (!owner) return;
  try {
    await owner.query('begin');
    const ids = users.map((u) => u.id);
    await owner.query('delete from public.allocations where booking_id in (select id from public.bookings where owner_id=any($1::uuid[]))',[ids]);
    await owner.query('delete from public.bookings where owner_id=any($1::uuid[])',[ids]);
    await owner.query('delete from private.app_roles where user_id=any($1::uuid[])',[ids]);
    await owner.query('commit');
    for (const user of users) {
      const deleted = await secretClient.auth.admin.deleteUser(user.id);
      if (deleted.error) throw new Error('Run-owned Auth cleanup failed; values withheld.');
    }
  } catch(error) {await owner.query('rollback');throw error;}
  finally {users.length = 0;await owner.end();}
});

test('visitors browse, selected visit survives login gate, callbacks and redirect attacks recover safely',async ({page,context}) => {
  const request=context.request;
  await page.goto('/');await expect(page.getByText('Choose your space. Check your date and hours above.')).toBeVisible();
  await selectChoice(page,'Your space',resource);
  await chooseDate(page,selection.date);
  await selectChoice(page,'Start time · WAT','10');await selectChoice(page,'Duration','2');
  await page.getByRole('button',{name:'Check availability',exact:true}).click();
  await page.getByRole('link',{name:'Continue to booking review'}).click();
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.locator('input[name="next"]')).toHaveValue(destination);
  for (const target of ['//evil.example','https://evil.example','/account?next=https://evil.example']) {
    const response = await request.post('/auth/sign-in',{headers,form:{next:target},maxRedirects:0});
    expect(response.status()).toBe(303);expect(new URL(response.headers().location).origin).toBe(origin);
    expect(new URL(response.headers().location).searchParams.get('message')).toBe('invalid-destination');assertPrivate(response);
  }
  expect((await request.post('/auth/sign-in',{headers:{Origin:'https://evil.example'},form:{next:'/account'}})).status()).toBe(403);
  const protectedPage = await request.get('/account',{maxRedirects:0});expect(protectedPage.status()).toBe(307);assertPrivate(protectedPage,true);
  for (const path of ['/auth/callback','/auth/callback?code=invalid','/auth/callback?code=invalid&next=//evil.example','/auth/callback?code=a&code=b']) {
    const response = await request.get(path,{maxRedirects:0});expect(response.status()).toBe(303);
    expect(new URL(response.headers().location).pathname).toBe('/login');assertPrivate(response);
  }
  await page.goto('/auth/callback?error=access_denied&error_description=untrusted');
  await expect(page.locator('.auth-notice')).toContainText('Sign-in was cancelled.');
  await expect(page.getByText('untrusted',{exact:true})).toHaveCount(0);
  await page.goto('/login?next=//evil.example');await expect(page.locator('.auth-notice')).toContainText('not allowed');
});

test('fresh review payment bounds and editable selection survive session loss without a new booking',async({page,context},info)=>{
  await signIn(context,users[0]);
  const visit={...selection,date:initialBookingDate(new Date(Date.now()+11*86400000))};
  const next=visitDestination(visit);
  await page.goto(next);await expect(page.getByLabel('Verified visit quote')).toContainText('₦4,000');
  await page.getByRole('radio',{name:/Full payment/}).check();
  await expect(page.getByLabel('Payment summary')).toContainText('₦0');
  await page.getByRole('radio',{name:/Custom amount/}).check();
  const amount=page.getByLabel('Payment amount in naira');const reserve=page.getByRole('button',{name:'Continue to test payment'});
  for(const value of ['1599.99','4000.01','1.001']) {await amount.fill(value);await expect(reserve).toBeDisabled();}
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.getByRole('checkbox',{name:/Remember booking/}).check();await page.getByRole('button',{name:'Save preferences'}).click();await waitForReservationSecurity(page);await amount.fill('2000.01');await expect(reserve).toBeEnabled();
  await expect(page.getByLabel('Payment summary')).toContainText('₦2,000.01');await expect(page.getByLabel('Payment summary')).toContainText('₦1,999.99');
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>v.id)).toEqual([]);
  mkdirSync('docs/screenshots/m4-refinement',{recursive:true});
  await page.screenshot({path:`docs/screenshots/m4-refinement/payment-custom-${info.project.name}.png`,fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
  await context.clearCookies({name:/^sb-/});await reserve.click();await expect(page).toHaveURL(/\/login\?message=session-ended/);
  await expect(page.locator('input[name=next]')).toHaveValue(next);
  await page.getByRole('link',{name:'Keep browsing',exact:true}).click();
  await expect(page.getByLabel('Your space',{exact:true})).toHaveAttribute('data-value',visit.resource);await expect(page.getByLabel('Date',{exact:true})).toHaveAttribute('data-value',visit.date);
  await expect(page.getByLabel('Start time · WAT',{exact:true})).toHaveAttribute('data-value','10');await expect(page.getByLabel('Duration',{exact:true})).toHaveAttribute('data-value','2');
  await expect(page.getByRole('link',{name:'Continue to booking review'})).toHaveCount(0);
  await signIn(context,users[0]);await page.goto(next);await expect(page.getByRole('radio',{name:/Custom amount/})).toBeChecked();await expect(amount).toHaveValue('2000.01');
  const before=(await owner.query('select count(*)::int as n from public.bookings where owner_id=$1',[users[0].id])).rows[0].n;
  await page.route('**/api/quote?*',async route=>{const response=await route.fetch();const data=await response.json();data.quote={...data.quote,hourly_kobo:250000,total_kobo:500000,deposit_kobo:200000,balance_kobo:300000};await route.fulfill({response,json:data});});
  let posts=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/checkout'&&r.method()==='POST') posts++;});
  await waitForReservationSecurity(page);await reserve.click();await expect(page.locator('.booking-status')).toContainText('The quote changed.');await expect(page.getByLabel('Verified visit quote')).toContainText('₦5,000');expect(posts).toBe(0);
  expect((await owner.query('select count(*)::int as n from public.bookings where owner_id=$1',[users[0].id])).rows[0].n).toBe(before);
  await page.unroute('**/api/quote?*');
  const rechecked=page.waitForResponse(response=>response.url().includes('/api/quote?'));
  await page.getByRole('button',{name:'Recheck price & availability'}).focus();
  await page.keyboard.press('Enter');
  expect((await rechecked).status()).toBe(200);
  await expect(page.getByLabel('Verified visit quote')).toContainText('₦4,000');
  await expect(page.getByRole('radio',{name:/Custom amount/})).toBeChecked();await expect(amount).toHaveValue('2000.01');
  await page.screenshot({path:`docs/screenshots/m4-refinement/payment-custom-${info.project.name}.png`,fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
});

test('genuine SSR session persists, refreshes through Auth, and rejects fabricated cookie identity',async ({page,context}) => {
  const session = await signIn(context,users[0]);
  const first = await page.goto('/account');expect(first).not.toBeNull();assertPrivate(first!,true);
  await expect(page.getByTestId('customer-identity')).toContainText(users[0].email);
  await page.reload();await expect(page.getByTestId('customer-identity')).toContainText(users[0].email);
  expect((await context.cookies()).filter((c) => c.name.startsWith('sb-')).every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);
  // Storage expiry is forced; the actual refresh token and Auth identity are genuine.
  await context.clearCookies({name:/^sb-/});await context.addCookies(sessionCookies({...session,expires_at:Math.floor(Date.now()/1000)-60}));
  const before = (await context.cookies()).filter((c) => c.name.startsWith('sb-')).map((c) => c.value).join('');
  const refreshed = await page.reload();assertPrivate(refreshed!,true);
  await expect(page.getByTestId('customer-identity')).toContainText(users[0].email);
  const after = (await context.cookies()).filter((c) => c.name.startsWith('sb-')).map((c) => c.value).join('');
  expect(before === after).toBe(false); // never print cookie values
  // A fabricated storage user has no authority even when bundled with a genuine customer token.
  const newSession = await signIn(context,users[0]);
  await context.clearCookies({name:/^sb-/});await context.addCookies(sessionCookies({...newSession,user:{...newSession.user,id:users[1].id,email:users[1].email,user_metadata:{role:'admin'}}}));
  await page.reload();await expect(page.getByTestId('customer-identity')).toContainText(users[0].email);
});

test('authenticated application hold reaches PostgreSQL as its customer; another customer and fake admin are rejected',async ({page,context,browser},info) => {
  await signIn(context,users[0]);await page.goto(destination);
  await expect(page.getByTestId('visit-selection')).toContainText(`${formatVisitDate(selection.date)} · 10:00–12:00 WAT · 2 hours`);
  await expect(page.getByLabel('Verified visit quote')).toContainText('₦4,000');
  const interval = intervalFromSelection(selection.date,10,2);
  const payload = {resourceId:resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId:randomUUID()};
  for (const key of ['ownerId','role','total_kobo','price','state']) {
    expect((await context.request.post(`${origin}/api/holds`,{headers,data:{...payload,[key]:'forged'}})).status()).toBe(400);
  }
  // Preserve M1's authenticated hold API regression; M2's new primary checkout
  // interface has its own real hosted-payment browser proof.
  expect((await context.request.post(`${origin}/api/holds`,{headers:{...headers,...await reservationHeaders(context,destination)},data:payload})).status()).toBe(201);
  await page.goto('/account');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Your visits.');
  const result = await context.request.get(`${origin}/api/holds`);expect(result.status()).toBe(200);assertPrivate(result);
  const body = await result.json();expect(body.bookings).toHaveLength(1);
  const hold = body.bookings[0];expect(hold.owner_id).toBe(users[0].id);expect(hold.resource_id).toBe(resource);
  await expect(page.locator('.visit-card')).toContainText(formatVisitDate(selection.date));
  await expect(page.locator('.visit-card .reservation-notice')).toContainText('Temporary reservation · expires');
  await expect(page.locator('.visit-card .reservation-notice')).toContainText('WAT');
  expect(hold.total_kobo).toBe(400000);expect(hold.deposit_kobo).toBe(160000);
  const stored = await owner.query('select owner_id,total_kobo from public.bookings where id=$1',[hold.id]);
  expect(stored.rows[0].owner_id).toBe(users[0].id);expect(Number(stored.rows[0].total_kobo)).toBe(400000);
  const other = await browser.newContext({baseURL:origin});
  try {
    await ensureEntrance(other);await signIn(other,users[1]);
    const view = await other.request.get('/api/holds');expect(view.status()).toBe(200);expect((await view.json()).bookings).toEqual([]);assertPrivate(view);
    const otherPage = await other.newPage();const otherResponse = await otherPage.goto('/account');assertPrivate(otherResponse!,true);
    await expect(otherPage.getByTestId('customer-identity')).toContainText(users[1].email);
    await expect(otherPage.locator('.visit-card')).toHaveCount(0);
    const ownResponse = await page.reload();assertPrivate(ownResponse!,true);
    await expect(page.getByTestId('customer-identity')).toContainText(users[0].email);
    await expect(page.locator('.visit-card')).toHaveCount(1);
    expect((await other.request.delete(`/api/holds/${hold.id}`,{headers})).status()).toBe(403);
    expect((await other.request.post('/api/closures',{headers,data:{resourceId:resource,startsAt:interval.starts_at,endsAt:interval.ends_at,reason:'spoofed metadata'}})).status()).toBe(403);
    expect((await other.request.get('/api/holds',{headers:{Authorization:'Bearer invalid-session'}})).status()).toBe(401);
    const anon = await browser.newContext({baseURL:origin});
    try {await ensureEntrance(anon);expect((await anon.request.get('/api/holds')).status()).toBe(401);expect((await anon.request.post('/api/holds',{headers,data:payload})).status()).toBe(401);} finally {await anon.close();}
  } finally {await other.close();}
  const a11y = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  // Capture the real customer screen without the test identity's email appearing in an artifact.
  await page.getByTestId('customer-identity').evaluate((node) => {node.textContent = 'Signed in as a verified test customer.';});
  mkdirSync('docs/screenshots/m4-refinement',{recursive:true});await page.screenshot({path:`docs/screenshots/m4-refinement/customer-regression-${info.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Release hold',exact:true}).click();
  await expect(page.getByRole('button',{name:'Release hold',exact:true})).toHaveCount(0);
});

test('sign-out clears this browser session; unusable expired session recovers to login and cannot call APIs',async ({page,context}) => {
  const request=context.request;
  const session = await signIn(context,users[0]);await page.goto('/account');
  expect((await request.post('/auth/sign-out',{headers:{Origin:'https://evil.example'},maxRedirects:0})).status()).toBe(403);
  expect((await request.get('/auth/sign-out')).status()).toBe(405);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('.auth-notice')).toContainText('You are signed out');
  expect((await context.cookies()).filter((c) => c.name.startsWith('sb-') && c.value).length).toBe(0);
  expect((await context.request.get(`${origin}/api/holds`)).status()).toBe(401);
  await page.goto('/account');await expect(page).toHaveURL(/\/login\?/);
  await context.addCookies(sessionCookies({...session,access_token:'invalid-access-token',refresh_token:'invalid-refresh-token',expires_at:Math.floor(Date.now()/1000)-60}));
  await page.goto('/account');await expect(page.locator('.auth-notice')).toContainText('Your session ended');
  expect((await context.request.get(`${origin}/api/holds`)).status()).toBe(401);
});
