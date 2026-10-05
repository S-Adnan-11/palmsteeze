import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {initialBookingDate} from '../../src/lib/domain';
test.use({trace:'off',screenshot:'off',video:'off'});
test.setTimeout(120000);

test('brand v2 public navigation, responsive preview and booking interaction states',async({page},info)=>{
  mkdirSync('docs/screenshots/m4-v2',{recursive:true});mkdirSync('docs/evidence/m4-v2',{recursive:true});
  const mode=info.project.name;const findings:Record<string,unknown>={};
  const mutations:string[]=[];page.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations.push(new URL(r.url()).pathname);});
  async function capture(name:string) {
    await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
    await page.evaluate(()=>Promise.all(Array.from(document.images,img=>{img.loading='eager';return img.decode().catch(()=>undefined);})));
    expect(await page.evaluate(()=>Array.from(document.images).every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
    await page.evaluate(()=>document.fonts.ready);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations,`${name} accessibility`).toEqual([]);
    await page.screenshot({path:`docs/screenshots/m4-v2/${name}-${mode}.png`,fullPage:true,animations:'disabled'});
    findings[name]={axeViolations:0,overflow:false};
  }
  await page.goto('/');await expect(page.getByRole('heading',{level:1})).toHaveText('Find yourwork rhythm.');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav.getByRole('link',{name:'Spaces',exact:true})).toBeVisible();await expect(nav.getByRole('link',{name:'My bookings'})).toBeVisible();
  expect(await nav.getByRole('link').allTextContents()).not.toContain('Admin preview');
  await expect(page.getByRole('navigation',{name:'Footer navigation'}).getByRole('link',{name:'About this project'})).toBeVisible();
  await expect(page.locator('.space-image img')).toHaveCount(5);
  expect(new Set(await page.locator('.space-image img').evaluateAll(images=>images.map(i=>i.getAttribute('src')))).size).toBe(5);
  await capture('home');
  await page.getByLabel('Date',{exact:true}).fill(initialBookingDate(new Date(Date.now()+86400000)));
  await page.getByLabel('Start time · WAT',{exact:true}).selectOption('10');
  let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/availability?*',async route=>{await gate;await route.continue();});
  await page.route('**/api/quote?*',async route=>{await gate;await route.continue();});
  await page.getByRole('button',{name:'Check availability',exact:true}).click();
  await expect(page.getByRole('button',{name:'Checking…',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Your space',{exact:true})).toBeDisabled();
  await page.locator('#plan').scrollIntoViewIfNeeded();await capture('booking-loading-disabled');release();
  await expect(page.locator('.booking-status')).toContainText('Available for these hours.');
  await page.unroute('**/api/availability?*');await page.unroute('**/api/quote?*');
  await capture('booking-available');
  await page.route('**/api/quote?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The booking service is temporarily unavailable. Please retry.'})}));
  await page.getByRole('button',{name:'Check availability',exact:true}).click();
  await expect(page.locator('.booking-status')).toContainText('temporarily unavailable');await capture('booking-error');await page.unroute('**/api/quote?*');
  await page.route('**/api/availability?*',async route=>{
    const response=await route.fetch();const body=await response.json();body.availability=body.availability.map((r:Record<string,unknown>)=>({...r,available:false}));
    await route.fulfill({response,json:body});
  });
  await page.getByRole('button',{name:'Check availability',exact:true}).click();
  await expect(page.locator('.booking-status')).toHaveAttribute('data-available','false');await capture('booking-unavailable');await page.unroute('**/api/availability?*');
  await page.goto('/login?message=cancelled');await capture('sign-in-recovery');
  await page.goto('/preview/admin');await capture('admin-preview-overview');
  const sectionNav=page.getByRole('navigation',{name:'Synthetic preview views'});
  await sectionNav.getByRole('button',{name:'Bookings',exact:true}).click();await page.getByLabel('Search bookings',{exact:true}).fill('No matching synthetic person');await expect(page.getByRole('heading',{name:'No matching bookings'})).toBeVisible();await capture('admin-empty-search');
  await page.getByLabel('Search bookings',{exact:true}).fill('Tomi');await expect(page.getByRole('list',{name:'Synthetic bookings'}).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button',{name:'Inspect sample PS-DEMO-105'}).click();await expect(page.getByRole('region',{name:'Selected sample booking'})).toContainText('Outstanding balance: ₦0');await capture('admin-preview-bookings');
  for(const [section,name] of [['Spaces','admin-preview-spaces'],['Availability','admin-preview-availability'],['Refunds & recovery','admin-preview-refunds'],['Audit','admin-preview-audit']] as const) {
    await sectionNav.getByRole('button',{name:section,exact:true}).click();await capture(name);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await sectionNav.getByRole('button',{name:'Overview',exact:true}).click();
  expect(await page.locator('form').count()).toBe(0);expect(await page.locator('main').getByRole('button').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringMatching(/approve|retry|settle|save|cancel/i)]));
  const original=page.viewportSize()!;
  for(const width of [360,768]) {
    await page.setViewportSize({width,height:width===360?800:1024});await capture(`admin-preview-width-${width}`);
    await page.goto('/');await capture(`home-width-${width}`);await page.goto('/preview/admin');
  }
  await page.setViewportSize(original);await page.goto('/');await page.getByRole('link',{name:'Skip to content'}).focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toBe('main');
  expect(mutations).toEqual([]);
  writeFileSync(`docs/evidence/m4-v2/visual-${mode}.json`,JSON.stringify({checkedAt:new Date().toISOString(),status:'PASSED',findings,controlledFaults:'Delayed read requests, HTTP 503 quote and unavailable inventory are browser-controlled UI faults; no provider or database failure claim.',syntheticPreview:'Separate static dataset; no forms or mutation requests.',financialOperations:'None performed by this visual test.',physicalDevices:'NOT RUN'},null,2)+'\n');
});
