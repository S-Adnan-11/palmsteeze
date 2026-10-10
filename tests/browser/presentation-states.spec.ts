import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {connectDatabase} from '../../scripts/lib/database';
import {initialBookingDate,intervalFromSelection} from '../../src/lib/domain';

test.use({baseURL:'http://localhost:3000',trace:'off',screenshot:'off',video:'off'});
test.setTimeout(90000);
test('rendered checkout return and history use concise truthful synthetic stored states',async({page,context},info)=>{
  expect(process.env.PALMSTEEZE_VISUAL_FIXTURES).toBe('local-review');
  const fixturePath='.tools/private/m4-standardization-fixture.json';mkdirSync('.tools/private',{recursive:true});
  const db=await connectDatabase();
  const resource=(await db.query("select id from public.resources where code='OPEN-15'")).rows[0].id;await db.end();
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`states-${randomUUID()}@palmsteeze.invalid`,password=randomBytes(32).toString('base64url');
  const made=await admin.auth.admin.createUser({email,password,email_confirm:true});if(made.error||!made.data.user)throw new Error('Synthetic Auth setup unavailable.');
  const user=made.data.user;const id=randomUUID();const results=[];
  try {
    const jar=new Map<string,string>();const auth=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>jar.set(name,value))}});
    expect((await auth.auth.signInWithPassword({email,password})).error).toBeNull();
    await context.addCookies([...jar].filter(([,v])=>v).map(([name,value])=>({name,value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax' as const})));
    await page.goto('/verify?next=/');await expect(page).toHaveURL('http://localhost:3000/',{timeout:30000});await page.getByRole('button',{name:'Necessary only',exact:true}).click();
    for(const [name,state,booking,refund,collected,returned,blocked] of [
      ['processing','open','held','none',0,0,false],['confirmed','paid','confirmed','none',100001,0,false],
      ['refund-pending','refund_required','cancelled','pending',100001,20001,false],
      ['refund-failed','review_required','cancelled','failed',100001,20001,true],
      ['refund-complete','refunded','cancelled','succeeded',100001,100001,false],
      ['checkout-expired','expired','expired','none',0,0,false],['payment-unavailable','paid','confirmed','none',100001,0,false],
    ] as const) {
      const interval=intervalFromSelection(initialBookingDate(new Date(Date.now()+18*86400000)),11,1);
      writeFileSync(fixturePath,JSON.stringify({owner:user.id,unavailable:name==='payment-unavailable',booking:{id,owner_id:user.id,resource_id:resource,...interval,state:booking,payment_kind:'checkout',total_kobo:200000,deposit_kobo:80000,balance_kobo:120000,deposit_percent:40,expires_at:new Date(Date.now()+1200000).toISOString(),created_at:new Date().toISOString()},payment:{id:randomUUID(),booking_id:id,state,refund_state:refund,refund_blocked:blocked,amount_kobo:100001,collected_kobo:collected,refunded_kobo:returned,cancel_requested:false,checkout_url:null,provider_expires_at:new Date(Date.now()+1200000).toISOString()}}));
      await page.goto('/booking/'+id+'?status=success&cancelled=true');
      if(name==='payment-unavailable')await expect(page.getByRole('heading',{name:'Status unavailable',exact:true})).toBeVisible();
      else {await expect(page.getByTestId('payment-state')).toContainText(state.replaceAll('_',' '));if(blocked)await expect(page.getByRole('region',{name:'Refund progress'})).toContainText('₦800');}
      for(const route of ['return','history']) {
        if(route==='history')await page.goto('/account');
        await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
        expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
        const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations.map(v=>v.id)).toEqual([]);
        if(name==='payment-unavailable'&&route==='history'){await expect(page.getByText('Amount paid',{exact:true})).toHaveCount(0);await expect(page.getByText('Payment status unavailable',{exact:true})).toBeVisible();}
        await page.screenshot({path:`docs/screenshots/m4-standardization/after-${route}-${name}-${info.project.name}.png`,fullPage:true,animations:'disabled',mask:[page.getByTestId('customer-identity')]});
        results.push({name,route,axeViolations:0,overflow:false});
      }
    }
    writeFileSync(`docs/evidence/m4-standardization/presentation-states-${info.project.name}.json`,JSON.stringify({kind:'local subprocess controlled read fixtures; real synthetic Auth; no stored business mutation or provider payment/refund evidence',returnFlagsHaveNoAuthority:true,results},null,2));
  } finally {try{unlinkSync(fixturePath);}catch{/* Fixture may already be removed. */}expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull();}
});
