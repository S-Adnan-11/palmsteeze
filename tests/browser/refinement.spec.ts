import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {initialBookingDate} from '../../src/lib/domain';
import {selectChoice} from './select-choice';
import {chooseDate} from './choose-date';
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
test.setTimeout(120000);
const directory=process.env.PALMSTEEZE_BROWSER_MODE==='polish'?'docs/screenshots/m4-polish':'docs/screenshots/m4-refinement';
const findings:Record<string,unknown>={};

test('live space choice, branded scheduling and restored Google cancellation keep a revalidated visit',async({page,context},info)=>{
  mkdirSync(directory,{recursive:true});await page.goto('/');
  await expect(page.getByRole('link',{name:'Find your space',exact:true})).toBeVisible();
  await page.getByRole('radio',{name:/Quiet desks/}).check();
  await page.getByRole('combobox',{name:'Your space',exact:true}).click();await expect(page.getByRole('option')).toHaveCount(8);
  await page.getByRole('option',{name:/^Quiet desk 02/}).click();
  const resource=await page.getByLabel('Your space',{exact:true}).getAttribute('data-value');const date=initialBookingDate(new Date(Date.now()+5*86400000));
  await chooseDate(page,date);await expect(page.getByLabel('Start time · WAT',{exact:true})).toBeEnabled();
  await selectChoice(page,'Start time · WAT','10');await selectChoice(page,'Duration','2');
  await expect(page.getByLabel('Editable visit summary')).toContainText('10:00–12:00');
  await page.getByRole('button',{name:'Check availability',exact:true}).click();
  await expect(page.getByRole('link',{name:'Continue to booking review'})).toBeVisible();
  await expect(page.getByLabel('Current visit quote')).toContainText('₦5,000');
  await page.locator('#plan').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/booking-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>v.id)).toEqual([]);
  await page.getByRole('link',{name:'Continue to booking review'}).click();await expect(page).toHaveURL(/\/login\?message=booking-required/);
  const next=await page.locator('input[name=next]').inputValue();await expect(page.locator('.signin-selection')).toContainText('Quiet desk 02');
  await page.screenshot({path:directory+'/sign-in-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
  const initiation=await context.request.post('/auth/sign-in',{headers:{Origin:'http://localhost:3000'},form:{next},maxRedirects:0});
  expect(initiation.status()).toBe(303);
  const provider=new URL(initiation.headers().location);expect(provider.origin).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);expect(provider.pathname).toBe('/auth/v1/authorize');expect(provider.searchParams.get('provider')).toBe('google');
  const enhanced=await context.request.post('/auth/sign-in',{headers:{Origin:'http://localhost:3000',Accept:'application/json'},form:{next},maxRedirects:0});
  expect(enhanced.status()).toBe(200);expect(enhanced.headers()['cache-control']).toContain('private');expect(enhanced.headers()['cache-control']).toContain('no-store');
  const enhancedProvider=new URL((await enhanced.json()).url);expect(enhancedProvider.origin).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);expect(enhancedProvider.pathname).toBe('/auth/v1/authorize');expect(enhancedProvider.searchParams.get('provider')).toBe('google');
  const invalidEnhanced=await context.request.post('/auth/sign-in',{headers:{Origin:'http://localhost:3000',Accept:'application/json'},form:{next:'//evil.example'},maxRedirects:0});expect(invalidEnhanced.status()).toBe(400);expect((await invalidEnhanced.json()).url).toBeUndefined();
  // Genuine OAuth initiation, then a controlled cancellation callback; no Google login is claimed.
  await page.goto('/auth/callback?error=access_denied&error_description=untrusted');
  await expect(page.locator('.auth-notice')).toContainText('Sign-in was cancelled.');await expect(page.locator('input[name=next]')).toHaveValue(next);
  await page.screenshot({path:directory+'/sign-in-cancelled-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
  await page.getByRole('link',{name:'Keep browsing',exact:true}).click();
  await expect(page.getByLabel('Your space',{exact:true})).toHaveAttribute('data-value',resource!);await expect(page.getByLabel('Date',{exact:true})).toHaveAttribute('data-value',date);
  await expect(page.getByLabel('Start time · WAT',{exact:true})).toHaveAttribute('data-value','10');await expect(page.getByLabel('Duration',{exact:true})).toHaveAttribute('data-value','2');
  await expect(page.getByRole('link',{name:'Continue to booking review'})).toHaveCount(0);
  await page.goBack();await expect(page.locator('input[name=next]')).toHaveValue(next);
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/auth/sign-in',async route=>{await gate;await route.fulfill({status:503,json:{error:'Google sign-in could not be started. Check your connection and try again.'}});});
  await page.getByRole('button',{name:'Continue with Google'}).click({noWaitAfter:true});await expect(page.getByRole('button',{name:'Opening Google…'})).toBeDisabled();await expect(page.locator('.signin-progress')).toContainText('Opening Google securely');
  await page.screenshot({path:directory+'/sign-in-loading-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});release();
  await expect(page.locator('.signin-error')).toContainText('could not be started');await expect(page.getByRole('button',{name:'Continue with Google'})).toBeEnabled();
  await expect(page.locator('input[name=next]')).toHaveValue(next);
  const loginAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(loginAxe.violations.map(v=>v.id)).toEqual([]);
  findings[info.project.name+'-live']={status:'PASSED',axeViolations:0,availability:'Existing live public RPC; no booking mutation',oauth:'Genuine Google initiation + controlled cancellation, not completed Google sign-in'};
});

test('loading, unavailable hours, read errors and delayed results cannot promise stale availability',async({page},info)=>{
  mkdirSync(directory,{recursive:true});let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/booking-options?*',async route=>{await gate;await route.fulfill({json:{source:'live',slots:[{hour:8,available:true},{hour:9,available:true},{hour:10,available:false},{hour:11,available:true}]}});});
  await page.goto('/');await expect(page.getByLabel('Start time · WAT',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Check availability',exact:true})).toBeDisabled();
  await page.locator('#plan').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/times-loading-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});release();
  await expect(page.getByLabel('Start time · WAT',{exact:true})).toBeEnabled();await page.getByLabel('Start time · WAT',{exact:true}).click();await expect(page.locator('[role=option][data-value="10"]')).toHaveAttribute('data-disabled','');await page.keyboard.press('Escape');
  await page.getByLabel('Duration',{exact:true}).click();await expect(page.getByRole('option')).toHaveCount(2);await page.keyboard.press('Escape');
  await page.screenshot({path:directory+'/valid-durations-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});await page.unroute('**/api/booking-options?*');
  await page.route('**/api/booking-options?*',route=>route.fulfill({status:503,json:{error:'Available times could not be loaded. Retry without changing your selection.'}}));
  await page.getByRole('radio',{name:/Quiet desks/}).check();await expect(page.getByRole('button',{name:'Retry available times'})).toBeVisible();await expect(page.getByRole('button',{name:'Check availability',exact:true})).toBeDisabled();
  await page.screenshot({path:directory+'/times-error-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
  await page.unroute('**/api/booking-options?*');await page.route('**/api/booking-options?*',route=>route.fulfill({json:{source:'live',slots:[]}}));
  await page.getByRole('button',{name:'Retry available times'}).click();await expect(page.locator('.time-feedback')).toContainText('No eligible hours');
  await page.screenshot({path:directory+'/times-empty-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});await page.unroute('**/api/booking-options?*');
  await page.getByRole('radio',{name:/Open desks/}).check();await expect(page.getByRole('button',{name:'Check availability',exact:true})).toBeEnabled();
  let resolve=()=>{};const delayed=new Promise<void>(r=>{resolve=r;});
  await page.route('**/api/quote?*',async route=>{try{const result=await route.fetch();await delayed;await route.fulfill({response:result});}catch{/* Item-switch abort is expected; do not leak a finished route into the next test. */}});
  await page.getByRole('button',{name:'Check availability',exact:true}).click();await expect(page.getByRole('button',{name:'Checking…',exact:true})).toBeDisabled();
  await page.getByRole('radio',{name:/Quiet desks/}).check();resolve();await expect(page.getByLabel('Editable visit summary')).toContainText('Quiet desk');await expect(page.getByRole('link',{name:'Continue to booking review'})).toHaveCount(0);
  await page.unrouteAll({behavior:'wait'});
  findings[info.project.name+'-faults']={status:'PASSED',faults:'Controlled browser delays, 503 and empty slots; no provider outage claim'};
});

test('natural scrolling has a static mobile/reduced-motion fallback and preview stays isolated',async({page},info)=>{
  mkdirSync(directory,{recursive:true});await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:directory+'/home-'+info.project.name+'.png',fullPage:true,animations:'disabled',style:'.skip-link:not(:focus){visibility:hidden !important}'});
  const section=page.locator('.workspace-experience');await expect(section).toHaveAttribute('data-motion',info.project.name==='desktop'?'scroll':'static');
  if(info.project.name==='desktop') {
    await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';const section=document.querySelector('.workspace-experience')!;window.scrollTo(0,section.getBoundingClientRect().top+scrollY+section.getBoundingClientRect().height-innerHeight);});
    await expect(section).toHaveAttribute('data-scene','2');
    await page.screenshot({path:directory+'/motion-create-desktop.png'});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await expect(section).toHaveAttribute('data-motion','static');
  await expect.poll(()=>section.locator('.experience-layer').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).opacity==='1'&&getComputedStyle(n).transform==='none'))).toBe(true);
  await page.locator('#plan').scrollIntoViewIfNeeded();await page.getByRole('radio',{name:/Open desks/}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:/Quiet desks/})).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.goto('/preview/admin');const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
  await page.getByRole('button',{name:'Refunds & recovery',exact:true}).click();await expect(page.getByRole('heading',{name:'A cancelled visit. An unresolved refund.'})).toBeVisible();
  await page.getByRole('button',{name:'Audit',exact:true}).click();expect(await page.locator('form').count()).toBe(0);expect(requests).toEqual([]);
  findings[info.project.name+'-motion-preview']={status:'PASSED',motion:info.project.name==='desktop'?'Scroll updates + reduced-motion static':'Static mobile',nativeRadioKeyboard:'PASSED',preview:'No API requests or forms',physicalPhone:'NOT RUN'};
});
test.afterAll(()=>{const dir=process.env.PALMSTEEZE_BROWSER_MODE==='polish'?'docs/evidence/m4-polish':'docs/evidence/m4-refinement';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/browser-'+test.info().project.name+'.json',JSON.stringify({checkedAt:new Date().toISOString(),...findings},null,2));});
