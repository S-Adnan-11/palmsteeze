import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
const evidence:Record<string,unknown>={};
test('grouped selectors manage keyboard focus, typeahead, disabled hours and touch-sized options',async({page},info)=>{
  await page.route('**/api/booking-options?*',route=>route.fulfill({json:{source:'live',slots:[{hour:8,available:true},{hour:9,available:false},{hour:10,available:true},{hour:11,available:true},{hour:12,available:true}]}}));
  await page.goto('/');const resource=page.getByRole('combobox',{name:'Your space',exact:true});
  await resource.focus();await page.keyboard.press('Enter');await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.locator('[role=option][data-state=checked]')).toBeFocused();await page.keyboard.type('Open desk 02',{delay:50});await expect(page.getByRole('option',{name:/^Open desk 02/})).toBeFocused();await page.keyboard.press('Enter');await expect(resource).toContainText('Open desk 02');await expect(resource).toBeFocused();
  const start=page.getByRole('combobox',{name:'Start time · WAT',exact:true});await expect(start).toBeEnabled();await start.focus();await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option',{name:/09:00/})).toHaveAttribute('data-disabled','');await expect(page.getByText('Morning · WAT',{exact:true})).toBeVisible();await expect(page.getByText('Afternoon · WAT',{exact:true})).toBeVisible();
  await page.keyboard.press('Home');await expect(page.getByRole('option',{name:/08:00/})).toBeFocused();await page.keyboard.press('ArrowDown');await expect(page.getByRole('option',{name:/10:00/})).toBeFocused();await page.keyboard.press('Enter');await expect(start).toHaveAttribute('data-value','10');await expect(start).toBeFocused();
  await start.click();await page.keyboard.press('Escape');await expect(start).toBeFocused();await expect(page.getByRole('listbox')).toHaveCount(0);
  await resource.click();await expect(page.getByRole('option').first()).toHaveAttribute('data-state',/checked|unchecked/);
  expect(await page.getByRole('option').first().evaluate(n=>n.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))).toEqual([]);
  await page.keyboard.press('Escape');await page.getByRole('radio',{name:/Grove/}).check();await expect(resource).toHaveCount(0);await page.getByRole('radio',{name:/Canopy/}).check();await expect(page.getByLabel('Editable visit summary')).toContainText('Canopy');
  if(info.project.name==='mobile') {
    await page.getByRole('radio',{name:/Cove/}).tap();await expect(page.getByLabel('Editable visit summary')).toContainText('Cove');
    await page.getByRole('radio',{name:/Quiet desks/}).check();const selected=await resource.getAttribute('data-value');await resource.tap();
    const viewport=page.locator('.brand-select-viewport');const box=(await viewport.boundingBox())!;const cdp=await page.context().newCDPSession(page);const x=box.x+box.width/2;const from=box.y+box.height-30;const to=box.y+30;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from,id:1}]});
    for(let step=1;step<=12;step++) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from+(to-from)*step/12,id:1}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    await expect.poll(()=>viewport.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);await expect(page.locator('#resource')).toHaveAttribute('data-value',selected!);await page.getByRole('option',{name:/^Quiet desk 08/}).tap();await expect(page.getByLabel('Editable visit summary')).toContainText('Quiet desk 08');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  evidence[info.project.name+'-select']={status:'PASSED',keyboard:'Typeahead, Home/Arrow skipping disabled, Enter, Escape and focus return',optionHeight:'>=48px',openMenuAxeViolations:0,touchSwipe:info.project.name==='mobile'?'Chrome touch-emulated swipe scrolls without selecting; last desk tap succeeds':'Not applicable'};
});
test('all workspace stages follow native scrolling; reduced motion stays static; shared preview is read-only',async({page},info)=>{
  await page.goto('/');await expect(page.getByRole('link',{name:'Find your space',exact:true})).toBeVisible();
  const section=page.locator('.workspace-experience');await expect(section.locator('[data-story-stage]')).toHaveCount(3);await expect(section).toContainText('Arrive. Take a little breath.');await expect(section).toContainText('Settle into your own desk.');await expect(section).toContainText('Gather around a good idea.');
  if(info.project.name==='desktop') {
    await expect(section).toHaveAttribute('data-motion','scroll');
    for(const [progress,scene] of [[0,'0'],[.5,'1'],[1,'2']] as const) {
      await section.evaluate((n,p)=>{const panel=n.querySelector<HTMLElement>('[data-story-panel]')!;const y=scrollY+n.getBoundingClientRect().top-parseFloat(getComputedStyle(panel).top)+p*(n.getBoundingClientRect().height-panel.offsetHeight);window.scrollTo({top:y,behavior:'instant'});},progress);
      await expect(section.locator('[aria-current="step"]')).toHaveAttribute('data-story-stage',scene);
    }
    await page.mouse.wheel(0,-150);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
  } else await expect(section).toHaveAttribute('data-motion','static');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(section).toHaveAttribute('data-motion','static');await expect(section.locator('[data-story-static]').first()).toBeVisible();
  await expect.poll(()=>section.locator('[data-story-scene]').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).transform==='none'))).toBe(true);
  await page.goto('/preview/admin');const requests:string[]=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url());});
  await page.getByRole('combobox',{name:'Booking status filter'}).click();await page.getByRole('option',{name:'Cancelled',exact:true}).click();await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button',{name:'Bookings',exact:true}).click();await expect(page.locator('#main')).toBeFocused();await expect(page.getByRole('heading',{level:1})).toHaveText('Every visit, in view.');
  await page.getByRole('button',{name:'Audit',exact:true}).click();await page.getByRole('button',{name:'Refunds & recovery',exact:true}).click();await expect(page.getByRole('heading',{name:'A cancelled visit. An unresolved refund.'})).toBeVisible();expect(requests).toEqual([]);expect(await page.locator('form').count()).toBe(0);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>v.id)).toEqual([]);
  evidence[info.project.name+'-motion-preview']={status:'PASSED',sequence:'Arrive → desk → room',reducedMotion:'Static paired image/copy',preview:'No API calls or forms; same dropdown and panel styles',phone:'NOT RUN'};
});
test.afterAll(()=>{mkdirSync('docs/evidence/m4-polish',{recursive:true});writeFileSync('docs/evidence/m4-polish/interaction-'+test.info().project.name+'.json',JSON.stringify({checkedAt:new Date().toISOString(),...evidence},null,2));});
