import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createClearance,createPreference} from '../../src/lib/security-sessions';
const origin='http://localhost:3000',evidence=process.env.PALMSTEEZE_REVIEW_ROOT||'docs/evidence/m4-entrance',screens=process.env.PALMSTEEZE_REVIEW_SCREENS||'docs/screenshots/m4-entrance';
test.use({baseURL:origin,trace:'off',screenshot:'off',video:'off'});
test.describe.configure({mode:'serial',timeout:90000});
test.beforeAll(()=>{mkdirSync(evidence,{recursive:true});mkdirSync(screens,{recursive:true});});
async function widget(page:Page) {
 await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={ready:cb=>cb(),render:(node,options)=>{window.proofOptions=options;node.innerHTML='<button type="button">Complete controlled check</button>';node.firstChild.onclick=()=>options.callback('controlled-'+(options.action==='entrance'?'entrance-':'pass-')+crypto.randomUUID());return 'fixture';},remove:()=>{}};`}));
}
async function enter(page:Page,destination='/') {await widget(page);await page.goto(destination);await expect(page).toHaveURL(/\/verify\?/);await page.getByRole('button',{name:'Complete controlled check'}).click();await expect(page).toHaveURL(url=>url.origin===origin&&url.pathname===destination.split('?')[0]);}
async function capture(page:Page,name:string){
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.complete||i.loading!=='lazy').map(i=>i.decode().catch(()=>{})));});
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();if(audit.violations.length)console.log(JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))));expect(audit.violations.map(v=>v.id)).toEqual([]);
 await page.screenshot({path:`${screens}/${name}.png`,fullPage:true,animations:'disabled'});
 if(await page.locator('.cookie-banner:visible,.cookie-dialog[open]').count())await page.screenshot({path:`${screens}/${name}-viewport.png`,fullPage:false,animations:'disabled'});
}
test('genuine widget investigation: real configuration, lifecycle and bounded provider result',async({page,context},info)=>{
 test.skip(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE==='true','Genuine-provider diagnostic requires genuine keys.');
 const responses:{status:number}[]=[],failures:string[]=[],errors:string[]=[];
 page.on('response',r=>{if(new URL(r.url()).hostname==='challenges.cloudflare.com')responses.push({status:r.status()});});
 page.on('requestfailed',r=>{if(new URL(r.url()).hostname==='challenges.cloudflare.com')failures.push(r.failure()?.errorText||'unknown');});
 page.on('pageerror',error=>{let message=error.message;for(const key of ['NEXT_PUBLIC_TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','PALMSTEEZE_SECURITY_SECRET'])if(process.env[key])message=message.replaceAll(process.env[key]!,'[withheld]');errors.push(message.replace(/https?:\/\/\S+/g,'[URL withheld]').slice(0,400));});
 await page.goto('/account');await expect(page).toHaveURL(/\/verify\?next=/);await capture(page,`entrance-genuine-initial-${info.project.name}`);
 let interacted=false;
 try {await expect.poll(()=>page.frames().filter(f=>f.url().startsWith('https://challenges.cloudflare.com/')).length,{timeout:10000}).toBeGreaterThan(0);const frame=page.frames().find(f=>f.url().startsWith('https://challenges.cloudflare.com/'));if(frame){await frame.getByRole('checkbox').check({timeout:5000});interacted=true;}}catch{
   // Ordinary pointer input at the visible horizontal widget's checkbox. No
   // challenge bypass, token injection or fingerprint/automation spoofing.
   await page.locator('.security-widget').click({position:{x:20,y:32}});interacted=true;
 }
 let completed=false;try{await expect(page).toHaveURL(/\/login\?/,{timeout:45000});completed=(await (await context.request.get('/api/verification')).json()).verified===true;}catch{/* Observed provider outcome, never relabel as a dummy-key success. */}
 const region=page.getByRole('region',{name:'Entrance verification'});
 const diagnostics=await region.count()?{state:await region.getAttribute('data-state'),code:await region.getAttribute('data-error-code'),message:await page.locator('#entrance-security-status').innerText(),widget:await page.locator('.security-widget').evaluate(n=>({children:n.children.length,iframe:!!n.querySelector('iframe'),apiPresent:!!window.turnstile}))}:{state:'server-confirmed-success'};
 const cookies=(await context.cookies()).map(({name,httpOnly,sameSite,secure,expires})=>({name,httpOnly,sameSite,secure,expires}));
 const storageOrigins=(await context.storageState()).origins.map(o=>({origin:o.origin,keys:o.localStorage.map(s=>s.name)}));
 writeFileSync(`${evidence}/genuine-entrance-${info.project.name}.json`,JSON.stringify({kind:'genuine-local-widget',canonicalOrigin:origin,configuredKeysPresent:!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY&&!!process.env.TURNSTILE_SECRET_KEY,testMode:process.env.PALMSTEEZE_TURNSTILE_TEST_MODE==='true',ordinaryCheckboxInteraction:interacted,entranceServerConfirmed:completed,ownerObserved:false,physicalPhone:false,responses,failures,pageErrors:errors,diagnostics,cookies,storageOrigins},null,2));
 await capture(page,`entrance-genuine-result-${info.project.name}`);
});
test('first arrival, policy exceptions, genuine gate and controlled successful deep-link entrance',async({page,context},info)=>{
 for(const path of ['/privacy','/cookies','/terms']){await page.goto(path);await expect(page).toHaveURL(origin+path);await capture(page,`${path.slice(1)}-${info.project.name}`);}
 await widget(page);await page.goto('/booking/review?resource=invalid');await expect(page).toHaveURL(/\/verify\?next=/);await capture(page,`entrance-ready-${info.project.name}`);
 await page.getByRole('button',{name:'Complete controlled check'}).click();await expect(page).toHaveURL(/\/login\?message=booking-required&next=/);await capture(page,`entrance-success-${info.project.name}`);
 const clearance=(await context.cookies()).find(c=>c.name==='ps-clearance')!;expect(clearance.httpOnly).toBe(true);expect(clearance.sameSite).toBe('Lax');expect(clearance.secure).toBe(false);expect(clearance.expires-Date.now()/1000).toBeLessThanOrEqual(1800);
 await page.goto('/');await expect(page.getByRole('region',{name:'Cookies and preferences'})).toBeVisible();await capture(page,`first-visit-banner-${info.project.name}`);
 await page.getByRole('button',{name:'Necessary only',exact:true}).click();await expect(page.locator('.cookie-banner')).toHaveCount(0);await page.reload();await expect(page).toHaveURL(url=>url.origin===origin&&url.pathname==='/' );await expect(page.locator('.cookie-banner')).toHaveCount(0);
 expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);await expect(page.getByRole('checkbox',{name:/Remember my choices/})).toHaveCount(0);
 const firstImage=page.locator('.space-image img').first();await firstImage.scrollIntoViewIfNeeded();await expect.poll(()=>firstImage.evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0),{timeout:10000}).toBe(true);
 await page.goto('/preview/admin');await expect(page.locator('.environment-label')).toContainText('Synthetic · Read-only');await capture(page,`preview-isolated-${info.project.name}`);
 writeFileSync(`${evidence}/storage-${info.project.name}.json`,JSON.stringify({kind:'controlled-widget; observed first-party browser storage',cookies:(await context.cookies()).map(({name,expires,httpOnly,sameSite,secure})=>({name,expires,httpOnly,sameSite,secure})),storage:await page.evaluate(()=>({session:Object.keys(sessionStorage),local:Object.keys(localStorage)}))},null,2));
});
test('preference acceptance, withdrawal, Escape/focus and narrow reduced-motion planner',async({page,context},info)=>{
 await enter(page);const banner=page.getByRole('region',{name:'Cookies and preferences'});await expect(banner).toBeVisible();
 await page.getByRole('button',{name:'Manage preferences'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:'Close cookie settings'})).toBeFocused();await capture(page,`preferences-${info.project.name}`);
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Manage preferences'})).toBeFocused();
 await page.route('**/api/preferences',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Controlled preference failure'}}):route.continue());await page.getByRole('button',{name:'Accept optional storage'}).click();await expect(page.locator('.cookie-error:visible')).toContainText('could not be saved');expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);await page.unroute('**/api/preferences');
 await page.getByRole('button',{name:'Accept optional storage'}).click();await expect(banner).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('palmsteeze.visit.v1'))).not.toBeNull();
 const other=await context.newPage();await other.goto('/');await expect.poll(()=>other.evaluate(()=>sessionStorage.getItem('palmsteeze.visit.v1'))).not.toBeNull();await page.bringToFront();
 const dateBefore=await page.getByRole('button',{name:'Date',exact:true}).innerText();
 await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.route('**/api/preferences',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Controlled preference failure'}}):route.continue());await page.getByRole('button',{name:'Necessary only',exact:true}).click();await expect(page.locator('.cookie-error:visible')).toContainText('could not be saved');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);await page.unroute('**/api/preferences');await page.getByRole('button',{name:'Close cookie settings'}).click();
 await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await page.getByRole('button',{name:'Necessary only',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);await expect(page.getByRole('button',{name:'Cookie settings',exact:true})).toBeFocused();expect(await page.getByRole('button',{name:'Date',exact:true}).innerText()).toBe(dateBefore);
 await expect.poll(()=>other.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);await other.close();
 await page.getByRole('button',{name:'Cookie settings',exact:true}).click();await expect(page.getByRole('checkbox',{name:/Remember booking/})).not.toBeChecked();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Cookie settings',exact:true})).toBeFocused();
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(page.locator('.workspace-experience')).toHaveAttribute('data-motion','static');
 await page.getByLabel('Your space',{exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByLabel('Your space',{exact:true})).toBeFocused();await page.getByRole('button',{name:'Date',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Date',exact:true})).toBeFocused();
 await page.setViewportSize({width:320,height:800});await capture(page,`planner-necessary-narrow-${info.project.name}`);
});
test('gate rejects missing forged expired and alternate-route clearance, keeps callback/policies reachable',async({context},info)=>{
 const checks=[];
 for(const path of ['/','/account','/admin','/preview/admin','/portfolio','/account/file.js','/api/quote','/api/holds','/api/checkout.png','/auth/sign-in']){const response=await context.request.get(path,{maxRedirects:0});expect([307,403]).toContain(response.status());checks.push({path,status:response.status()});}
 for(const value of ['true',createClearance(process.env,Date.now()-1801000),createPreference(true,process.env)]){await context.addCookies([{name:'ps-clearance',value,url:origin,httpOnly:true,sameSite:'Lax'}]);const r=await context.request.post('/api/checkout',{headers:{Origin:origin},data:{verified:true}});expect(r.status()).toBe(403);expect((await r.json()).entranceRequired).toBe(true);}
 for(const path of ['/privacy','/cookies','/terms','/api/preferences','/api/verification','/auth/callback']){const r=await context.request.get(path,{maxRedirects:0});expect(r.status()).not.toBe(403);if(r.status()===307)expect(r.headers().location).not.toContain('/verify');}
 await context.clearCookies();for(const [token,status] of [['',403],['controlled-invalid',403],['controlled-expired',403],['controlled-hostname',403],['controlled-action',403],['controlled-old',403],['controlled-provider',503],['controlled-timeout',503],['controlled-pass-reserve-only',403]] as const){const r=await context.request.post('/api/verification',{headers:{Origin:origin},data:{token,next:'/'}});expect(r.status()).toBe(status);expect((await context.cookies()).some(c=>c.name==='ps-clearance')).toBe(false);}
 const token='controlled-entrance-'+randomUUID();expect((await context.request.post('/api/verification',{headers:{Origin:origin},data:{token,next:'/'}})).status()).toBe(200);expect((await context.request.post('/api/verification',{headers:{Origin:origin},data:{token,next:'/'}})).status()).toBe(403);
 writeFileSync(`${evidence}/gate-${info.project.name}.json`,JSON.stringify({kind:'controlled-provider endpoint checks; no client clearance bypass',checks,forgedAndExpiredDenied:true,entranceFaultsAndReplayDenied:true},null,2));
});
test('blocked and expired check retries retain internal destination',async({page},info)=>{
 await page.route('https://challenges.cloudflare.com/**',r=>r.abort());await page.goto('/account');await expect(page.locator('#entrance-security-status')).toContainText('could not load');await capture(page,`entrance-blocked-${info.project.name}`);
 await page.unroute('https://challenges.cloudflare.com/**');await widget(page);await page.getByRole('button',{name:'Retry security check'}).click();await expect(page.getByRole('button',{name:'Complete controlled check'})).toBeVisible();await page.evaluate(()=>{(window as unknown as {proofOptions:Record<string,()=>void>}).proofOptions['expired-callback']();});await expect(page.locator('#entrance-security-status')).toContainText('expired');await page.getByRole('button',{name:'Retry security check'}).click();await page.getByRole('button',{name:'Complete controlled check'}).click();await expect(page).toHaveURL(/\/login\?message=session-ended&next=/);
});
