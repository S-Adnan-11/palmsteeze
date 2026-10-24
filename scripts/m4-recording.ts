import {chromium,type Page} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,copyFileSync,constants,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {connectDatabase,inspectDatabase} from './lib/database';
import {initialBookingDate} from '../src/lib/domain';
import {visitDestination} from '../src/lib/auth/destinations';

async function main() {
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New run root required');
  const output=join(root,`recordings-${Date.now()}-${randomUUID().slice(0,8)}`);mkdirSync(output);mkdirSync(join(output,'raw'));
  const db=await connectDatabase();await inspectDatabase(db);
  if(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE!=='true')throw new Error('Official test-key recording environment required');
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  try {
    for(const mode of ['desktop','mobile']) {
      const email=`m4-recording-${randomUUID()}@palmsteeze.invalid`,password=randomBytes(32).toString('base64url');
      const made=await admin.auth.admin.createUser({email,password,email_confirm:true});if(!made.data.user)throw new Error('Synthetic Auth setup failed');
      const userId=made.data.user.id;
      await db.query('insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at,last_sign_in_at) values($1,$2,$3,$4,$5,now(),now(),now())',[randomUUID(),userId,userId,'google',{sub:userId,email,email_verified:true,full_name:'Demo Visitor'}]);
      const viewport=mode==='desktop'?{width:1440,height:1000}:{width:390,height:664};
      const context=await browser.newContext({viewport,isMobile:mode==='mobile',hasTouch:mode==='mobile',reducedMotion:'no-preference',recordVideo:{dir:join(output,'raw'),size:viewport}});
      const jar=new Map<string,string>();const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
      if((await client.auth.signInWithPassword({email,password})).error)throw new Error('Synthetic login failed');
      await context.addCookies([...jar].filter(([,value])=>value).map(([name,value])=>({name,value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax' as const})));
      const page=await context.newPage();let bookingId:string|undefined;
      async function cleanup(){
        if(bookingId) {
          const stop=await context.request.delete(`http://localhost:3000/api/bookings/${bookingId}/checkout`,{headers:{Origin:'http://localhost:3000'}});
          const status=await stop.json();if(!stop.ok||status.payment?.state!=='expired'||Number(status.payment.collected_kobo)!==0)throw new Error('Unpaid fixture not safely expired; retained');
          await db.query('begin');try {
            await db.query('delete from private.payment_events where attempt_id in (select id from public.payment_attempts where owner_id=$1)',[userId]);
            await db.query('delete from private.payment_jobs where attempt_id in (select id from public.payment_attempts where owner_id=$1)',[userId]);
            await db.query('delete from public.payment_attempts where owner_id=$1',[userId]);await db.query('delete from public.allocations where booking_id in (select id from public.bookings where owner_id=$1)',[userId]);await db.query('delete from public.bookings where owner_id=$1',[userId]);await db.query('commit');
          }catch(error){await db.query('rollback');throw error;}
        }
        await context.close();if((await admin.auth.admin.deleteUser(userId)).error)throw new Error('Synthetic Auth cleanup failed');
      }
      async function capture(name:string,target:Page=page){writeFileSync(join(output,`${name}-${mode}.png`),await target.screenshot(),{flag:'wx'});}
      try {
        await page.goto('http://localhost:3000/verify?next=/');await page.waitForURL('http://localhost:3000/',{timeout:30000});
        await page.getByRole('button',{name:'Necessary only',exact:true}).click();
        await page.locator('.workspace-experience').scrollIntoViewIfNeeded();
        if(mode==='desktop')await page.evaluate(`(async()=>{
          const rect=document.querySelector('.workspace-experience').getBoundingClientRect(),start=scrollY+rect.top-innerHeight*.15,end=start+rect.height-innerHeight*.8;
          const began=performance.now();await new Promise(resolve=>{function tick(time){const t=Math.min(1,(time-began)/4500);window.scrollTo({top:start+(end-start)*t,behavior:'instant'});if(t<1)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});
        })()`);
        else await page.waitForTimeout(900);
        await page.locator('#plan').scrollIntoViewIfNeeded();
        for(const id of ['resource','date','start','duration']) {await page.locator('#'+id).click();await page.waitForTimeout(500);await capture('control-'+id);await page.keyboard.press('Escape');}
        const resource=(await db.query('select id from public.resources where code=$1',[mode==='desktop'?'OPEN-13':'OPEN-14'])).rows[0].id;
        const destination=visitDestination({resource,date:initialBookingDate(new Date(Date.now()+21*86400000)),hour:12,duration:1});
        await page.goto('http://localhost:3000'+destination);
        await page.locator('label').filter({has:page.getByRole('radio',{name:/Custom amount/})}).click();await page.getByLabel('Payment amount in naira').fill('1000.01');
        await page.getByRole('button',{name:'Continue to test payment',exact:true}).scrollIntoViewIfNeeded();await capture('review-ready');
        await page.getByRole('button',{name:'Continue to test payment',exact:true}).click();await page.waitForURL(/\/booking\/[0-9a-f-]+$/,{timeout:60000});bookingId=new URL(page.url()).pathname.split('/').at(-1)!;
        await page.getByRole('region',{name:'Sandbox test card'}).scrollIntoViewIfNeeded();await capture('test-card');
        if(mode==='mobile'){
          await page.setViewportSize({width:320,height:664});await page.getByRole('region',{name:'Sandbox test card'}).scrollIntoViewIfNeeded();
          if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw new Error('Narrow helper overflow');
          await capture('test-card-320');await page.setViewportSize(viewport);
        }
        await context.grantPermissions(['clipboard-write','clipboard-read']);await page.getByRole('button',{name:'Copy card number',exact:true}).click();await page.waitForTimeout(500);
        if(mode==='desktop') {
          const popupEvent=page.waitForEvent('popup');await page.getByRole('button',{name:'Open card companion ↗',exact:true}).click();const popup=await popupEvent;await popup.waitForURL('http://localhost:3000/booking/'+bookingId+'/test-card');await popup.locator('[data-card-field]').first().waitFor();await capture('companion',popup);await popup.close();
        }
        await page.getByRole('link',{name:'Continue to test payment',exact:true}).click();await page.locator('#cardNumber').waitFor({timeout:45000});await page.waitForTimeout(700);await capture('hosted-stripe');
        writeFileSync(join(output,`recording-${mode}.json`),JSON.stringify({kind:'Official Cloudflare test keys and real Siteverify, real synthetic seeded identity/DB and unpaid Stripe sandbox Checkout; no genuine Turnstile or Google OAuth/phone claim',bookingId,normalDesktopMotion:mode==='desktop',intentionalMobileStatic:mode==='mobile',controlsStable:true,necessaryOnly:true,cardCopy:true,hostedCheckoutRetained:true},null,2),{flag:'wx'});
      } finally {
        const video=page.video();await page.close();if(video)copyFileSync(await video.path(),join(output,`journey-${mode}.webm`),constants.COPYFILE_EXCL);
        await cleanup();
      }
    }
    console.log('Recordings saved in '+output);
  } finally {await browser.close();await db.end();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Recording failed');process.exitCode=1;});
