import {test,expect,type BrowserContext} from '@playwright/test';
import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Client} from 'pg';
import {verifyProject,connectDatabase} from '../../scripts/lib/database';
import {initialBookingDate} from '../../src/lib/domain';
import {visitDestination} from '../../src/lib/auth/destinations';
import {waitForReservationSecurity} from './reservation-security';
import AxeBuilder from '@axe-core/playwright';
test.use({baseURL:'http://localhost:3000',trace:'off',screenshot:'off',video:{mode:'on',size:{width:1440,height:1000}}});
test.describe.configure({mode:'serial',timeout:120000});
const origin='http://localhost:3000';let db:Client;let admin:ReturnType<typeof createClient>;let user:{id:string;email:string;password:string};let resource:string;
async function signIn(context:BrowserContext){const jar=new Map<string,string>();const api=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});expect((await api.auth.signInWithPassword({email:user.email,password:user.password})).error).toBeNull();await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:origin,httpOnly:true,sameSite:'Lax' as const})));}
test.beforeAll(async()=>{await verifyProject();db=await connectDatabase();admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});const email=`visitor-${randomUUID()}@palmsteeze.invalid`,password=randomBytes(32).toString('base64url');const made=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Demo visitor'}});expect(made.error).toBeNull();user={id:made.data.user!.id,email,password};resource=(await db.query("select id from public.resources where code='OPEN-15'")).rows[0].id;mkdirSync('docs/recordings/m4-entrance',{recursive:true});});
test.afterAll(async()=>{if(!db)return;try{if(user){expect((await db.query("select count(*)::int n from public.payment_attempts where owner_id=$1 and (collected_kobo<>0 or state not in ('expired','creation_failed'))",[user.id])).rows[0].n).toBe(0);await db.query('begin');await db.query('delete from public.admin_audit where target_id in(select id from public.bookings where owner_id=$1)',[user.id]);await db.query('delete from private.payment_events where attempt_id in(select id from public.payment_attempts where owner_id=$1)',[user.id]);await db.query('delete from public.payment_attempts where owner_id=$1',[user.id]);await db.query('delete from public.allocations where booking_id in(select id from public.bookings where owner_id=$1)',[user.id]);await db.query('delete from public.bookings where owner_id=$1',[user.id]);await db.query('commit');expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull();}}finally{await db.end();}});
test('official test-widget recording: entrance, necessary-only choice, booking and safe unpaid stop',async({page,context},info)=>{
 expect(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE).toBe('true');await signIn(context);
 await page.goto('/');await expect(page).toHaveURL(/\/verify\?/);await expect(page).toHaveURL(origin+'/',{timeout:30000});
 await page.getByRole('button',{name:'Necessary only',exact:true}).click();expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
 const selection={resource,date:initialBookingDate(new Date(Date.now()+19*86400000)),hour:11,duration:1};
 // Use the approved planner's internal visit URL; authentication came from a
 // legitimate password fixture. This recording is not a Google OAuth proof.
 await page.goto(visitDestination(selection));await expect.poll(()=>page.locator('.review-space img').evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0),{timeout:15000}).toBe(true);await waitForReservationSecurity(page);
 await page.getByRole('radio',{name:/Custom amount/}).check();await page.getByLabel('Payment amount in naira').fill('1000.01');
 await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.getByRole('checkbox',{name:/Remember booking/}).check();await page.getByRole('button',{name:'Save preferences'}).click();await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('palmsteeze.payment.v1:')))).toBe(true);
 await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.getByRole('button',{name:'Necessary only',exact:true}).click();await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
 // Expired entrance: preserve live input, verify in another tab, then retry.
 await context.clearCookies({name:'ps-clearance'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('.verification-renewal')).toBeVisible();
 const renewal=await context.newPage();await renewal.goto('/verify?next=/');await expect(renewal).toHaveURL(origin+'/',{timeout:30000});await renewal.close();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('.verification-renewal')).toHaveCount(0);await expect(page.getByLabel('Payment amount in naira')).toHaveValue('1000.01');
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations.map(v=>v.id)).toEqual([]);
 await page.getByRole('button',{name:'Continue to test payment'}).click();await expect(page).toHaveURL(/\/booking\/[0-9a-f-]+$/,{timeout:60000});const id=new URL(page.url()).pathname.split('/').pop();await expect(page.getByRole('link',{name:/Continue.*Checkout|Continue.*payment|Resume.*payment/i})).toBeVisible({timeout:45000});
 await page.screenshot({path:`docs/screenshots/m4-entrance/booking-necessary-${info.project.name}.png`,fullPage:true,animations:'disabled',mask:[page.getByTestId('customer-identity')]});
 const video=page.video();await page.close();await video?.saveAs(`docs/recordings/m4-entrance/visitor-official-${info.project.name}.webm`);
 const stopped=await context.request.delete(`/api/bookings/${id}/checkout`,{headers:{Origin:origin}});expect(stopped.status()).toBe(200);expect((await stopped.json()).payment.state).toBe('expired');
 writeFileSync(`docs/evidence/m4-entrance/official-visitor-${info.project.name}.json`,JSON.stringify({kind:'real official Cloudflare test widget + Siteverify; real Supabase Auth/database/Stripe sandbox',necessaryOnlyBooking:true,optionalAcceptanceAndWithdrawalPreserveAmount:true,expiredClearanceRenewedInSeparateTab:true,unpaidCheckoutSafelyExpired:true,genuineWidget:false,physicalPhone:false,completedGoogleWalkthrough:false},null,2));
});
