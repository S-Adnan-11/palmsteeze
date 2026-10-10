import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {bookingDateRange,eligibleHours} from '../../src/lib/booking-options';
import {workingDefaults,initialBookingDate} from '../../src/lib/domain';
import {dateEntry,formatVisitDate} from '../../src/lib/visit-dates';
import {chooseDate} from './choose-date';
import {selectChoice} from './select-choice';
test.use({baseURL:'http://localhost:3000',trace:'off',video:'off',screenshot:'off'});
const findings:Record<string,unknown>={};
const dir='docs/screenshots/m4-clarity';
const style='.skip-link:not(:focus){visibility:hidden !important}';

test('calendar manages keyboard focus, date entry, disabled days and mobile-sized targets',async({page},info)=>{
  await page.goto('/');const date=initialBookingDate(new Date(Date.now()+3*86400000));await chooseDate(page,date);
  const trigger=page.getByRole('button',{name:'Date',exact:true});await expect(trigger).toContainText(formatVisitDate(date));await expect(trigger).toBeFocused();
  await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Choose a visit date'});await expect(dialog).toBeVisible();
  const selected=dialog.getByRole('button',{name:formatVisitDate(date),exact:true});await expect(selected).toBeFocused();
  await page.keyboard.press('ArrowRight');await expect(selected).not.toBeFocused();
  const focused=await page.locator('.rdp-day_button:focus').getAttribute('aria-label');await page.keyboard.press('Enter');await expect(dialog).toHaveCount(0);await expect(trigger).toContainText(focused!);await expect(trigger).toBeFocused();
  await trigger.click();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(dialog).toHaveCount(0);
  await trigger.click();await expect(dialog.getByRole('button',{name:'Go to the previous month'})).toBeDisabled();
  const now=new Date();const range=bookingDateRange(workingDefaults,now);
  const labels=await dialog.locator('.rdp-day_button').evaluateAll(nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),disabled:(n as HTMLButtonElement).disabled})));
  const sunday=labels.find(item=>item.label?.startsWith('Sun,'));if(sunday)expect(sunday.disabled).toBe(true);
  const previous=new Date(range.min+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
  const past=dialog.getByRole('button',{name:formatVisitDate(previous.toISOString().slice(0,10)),exact:true});if(await past.count())await expect(past).toBeDisabled();
  const entry=page.getByLabel('Enter date · DD/MM/YYYY',{exact:true});
  for(const [value,message] of [['31/02/2026','valid date'],[dateEntry(previous.toISOString().slice(0,10)),'open day']] as const) {
    await entry.fill(value);await page.getByRole('button',{name:'Use date',exact:true}).click();await expect(page.locator('.calendar-error')).toContainText(message);await expect(dialog).toBeVisible();
  }
  const max=range.max;await entry.fill(dateEntry(max));
  if(eligibleHours(max,workingDefaults,now).length){await page.keyboard.press('Enter');await expect(trigger).toHaveAttribute('data-value',max);}else {await page.keyboard.press('Enter');await expect(page.locator('.calendar-error')).toContainText('open day');await page.keyboard.press('Escape');}
  await trigger.click();const nextMonth=dialog.getByRole('button',{name:'Go to the next month'});if(await nextMonth.isEnabled())await nextMonth.click();await expect(nextMonth).toBeDisabled();
  expect(await dialog.locator('.rdp-day_button').first().evaluate(n=>n.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await dialog.locator('#date-entry').evaluate(n=>Number.parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))).toEqual([]);
  mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/calendar-'+info.project.name+'.png',style});
  await page.getByRole('button',{name:'Close calendar'}).click();await expect(trigger).toBeFocused();
  await trigger.click();await page.mouse.click(5,5);await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  if(info.project.name==='mobile') {
    await trigger.tap();const day=dialog.locator('.rdp-day_button:not([disabled])').first();const label=await day.getAttribute('aria-label');await day.tap();await expect(dialog).toHaveCount(0);await expect(trigger).toContainText(label!);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  findings[info.project.name+'-calendar']={status:'PASSED',keyboard:'Enter/arrows/select/Escape, explicit entry and focus return',bounds:'Past, impossible and Sunday rejected; final eligible horizon day accepted; month navigation bounded',mobile:'Chrome emulation, 44px-high days and 16px entry',axeViolations:0};
});

test('room cards identify the whole resource; switching and sign-in preserve selection without promising a reservation',async({page},info)=>{
  await page.goto('/');const date=initialBookingDate(new Date(Date.now()+5*86400000));await chooseDate(page,date);
  await selectChoice(page,'Start time · WAT','10');await selectChoice(page,'Duration','2');
  await page.getByRole('radio',{name:/Grove/}).check();await expect(page.getByRole('combobox',{name:'Your space',exact:true})).toHaveCount(0);await expect(page.getByRole('group',{name:'Selected room'})).toContainText('Grove');
  await page.getByRole('button',{name:/Change room/}).click();await expect(page.getByRole('radio',{name:/Grove/})).toBeFocused();await page.keyboard.press('ArrowRight');await expect(page.getByRole('group',{name:'Selected room'})).toContainText('Canopy');
  await page.getByRole('radio',{name:/Quiet desks/}).check();
  await page.getByRole('combobox',{name:'Your space',exact:true}).click();await page.getByRole('option',{name:/^Quiet desk 02/}).click();const desk=await page.getByRole('combobox',{name:'Your space',exact:true}).getAttribute('data-value');
  await page.getByRole('radio',{name:/Cove/}).check();const room=await page.getByRole('group',{name:'Selected room'}).getAttribute('data-resource-id');expect(room).not.toBe(desk);
  await expect(page.getByRole('button',{name:'Date',exact:true})).toHaveAttribute('data-value',date);await expect(page.getByRole('combobox',{name:'Start time · WAT'})).toHaveAttribute('data-value','10');await expect(page.getByRole('combobox',{name:'Duration'})).toHaveAttribute('data-value','2');
  await page.getByRole('button',{name:'Check availability',exact:true}).click();await expect(page.getByRole('link',{name:'Continue to booking review'})).toBeVisible();
  await expect(page.getByLabel('Editable visit summary')).toContainText(formatVisitDate(date));await page.locator('#plan').screenshot({path:dir+'/room-planner-'+info.project.name+'.png',style});
  await page.getByRole('link',{name:'Continue to booking review'}).click();await expect(page.locator('.login-content .eyebrow').first()).toHaveText('Your plans, ready to continue');await expect(page.locator('.signin-selection')).toContainText('No space is reserved yet.');await expect(page.locator('.signin-selection')).toContainText(formatVisitDate(date));
  const next=await page.locator('input[name=next]').inputValue();expect(new URL(next,'https://app.invalid').searchParams.get('resource')).toBe(room);
  await page.getByRole('link',{name:'Keep browsing',exact:true}).click();await expect(page.getByRole('group',{name:'Selected room'})).toHaveAttribute('data-resource-id',room!);await expect(page.getByRole('button',{name:'Date',exact:true})).toHaveAttribute('data-value',date);await expect(page.getByRole('link',{name:'Continue to booking review'})).toHaveCount(0);
  await page.getByRole('radio',{name:/Open desks/}).check();await expect(page.getByRole('combobox',{name:'Your space',exact:true})).toContainText('Open desk 01');await expect(page.getByRole('button',{name:'Date',exact:true})).toHaveAttribute('data-value',date);
  for(const selector of ['.schedule-grid .field-help','.choice-detail','.planner-summary .booking-status'])expect(await page.locator(selector).first().evaluate(n=>Number.parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(14);
  findings[info.project.name+'-selection']={status:'PASSED',resources:'Stable room/desk IDs; room cards and summary replace duplicate selector; change-room focus; individual desks retained',persistence:'Date/hours survive switches and sign-in gate/back; checked availability cleared',copy:'Saved selection and temporary reservation distinguished',supportingText:'At least 14px at tested normal zoom'};
});

test('calendar and summaries keep the Lagos date in widely different browser timezones',async({browser},info)=>{
  const date=initialBookingDate(new Date(Date.now()+4*86400000));
  for(const timezoneId of ['Pacific/Honolulu','Pacific/Kiritimati']) {
    const context=await browser.newContext({timezoneId,viewport:info.project.use.viewport,isMobile:info.project.name==='mobile',hasTouch:info.project.name==='mobile'});
    try {const page=await context.newPage();await page.goto('http://localhost:3000');await chooseDate(page,date);await expect(page.getByLabel('Editable visit summary')).toContainText(formatVisitDate(date));await page.getByRole('button',{name:'Date',exact:true}).click();await expect(page.locator('.rdp-selected .rdp-day_button')).toHaveAttribute('aria-label',formatVisitDate(date));await page.keyboard.press('Escape');const url=new URL(page.url());expect(url.searchParams.get('date')).toBe(date);}finally{await context.close();}
  }
  findings[info.project.name+'-timezone']={status:'PASSED',zones:['UTC−10 Honolulu','UTC+14 Kiritimati'],date:'Calendar selection, displayed day and canonical query are unchanged'};
});
test.afterAll(()=>{mkdirSync('docs/evidence/m4-clarity',{recursive:true});writeFileSync('docs/evidence/m4-clarity/browser-'+test.info().project.name+'.json',JSON.stringify({checkedAt:new Date().toISOString(),...findings},null,2));});
