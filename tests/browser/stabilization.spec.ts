import {test,expect,type Page} from '@playwright/test';
import {createClearance} from '../../src/lib/security-sessions';
import {initialBookingDate} from '../../src/lib/domain';
import {chooseDate} from './choose-date';
import {selectChoice} from './select-choice';
import {capture,record} from './targeted-artifacts';

const origin='http://localhost:3000';
const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const items:string[]=[];errors.set(page,items);page.on('pageerror',error=>items.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource'))items.push(message.text());});});
test.afterEach(async({page})=>{expect(errors.get(page)||[],'uncaught browser errors').toEqual([]);});

test('entrance continuation confirms the signed cookie; consent accepts rejects and withdraws without losing input',async({page,context},info)=>{
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={ready:cb=>cb(),render:(node,options)=>{node.innerHTML='<button type="button">Complete controlled check</button>';node.firstChild.onclick=()=>options.callback('controlled-entrance');return 'controlled';},remove:()=>{}};window.palmsteezeTurnstileLoaded?.();`}));
  let submissions=0;
  await page.route('**/api/verification',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    submissions++;
    await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:origin,httpOnly:true,sameSite:'Lax'}]);
    await route.fulfill({json:{verified:true,destination:route.request().postDataJSON().next}});
  });
  await page.goto('/?date='+initialBookingDate()+'#plan');await expect(page).toHaveURL(/\/verify\?/);
  await page.getByRole('button',{name:'Complete controlled check'}).click();await expect(page).toHaveURL(/#plan$/);
  expect(submissions).toBe(1);expect((await (await context.request.get('/api/verification')).json()).verified).toBe(true);
  await expect(page.getByRole('link',{name:'Continue to PalmSteeze'})).toHaveCount(0);
  const banner=page.getByRole('region',{name:'Cookies and preferences'});await expect(banner).toBeVisible();
  await page.getByRole('button',{name:'Necessary only',exact:true}).click();await expect(banner).toHaveCount(0);
  expect((await (await context.request.get('/api/preferences')).json()).preference.optional).toBe(false);
  await expect(page.locator('#start')).toBeEnabled();expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
  const resource=await page.locator('#resource').getAttribute('data-value');
  const settings=page.getByRole('button',{name:'Cookie settings',exact:true});await settings.click();
  await page.keyboard.press('Escape');await expect(settings).toBeFocused();
  await settings.click();await page.getByRole('checkbox',{name:/Remember booking/}).check();await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect(page.locator('.cookie-dialog')).not.toHaveAttribute('open','');
  expect((await (await context.request.get('/api/preferences')).json()).preference.optional).toBe(true);
  await page.evaluate(()=>{sessionStorage.setItem('palmsteeze.visit.v1','controlled-draft');sessionStorage.setItem('palmsteeze.payment.v1:controlled','controlled-draft');});
  await settings.click();await page.locator('.cookie-dialog').getByRole('button',{name:'Necessary only',exact:true}).click();
  await expect(settings).toBeFocused();expect(await page.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);
  expect(await page.locator('#resource').getAttribute('data-value')).toBe(resource);
  await capture(page,'consent-retained',info);
  record('entrance-consent-'+info.project.name+'.json',{kind:'Controlled widget and verification POST; test-issued signed clearance; actual cookie confirmation, continuation and consent endpoints. NOT genuine Turnstile success.',automaticContinuation:true,rejection:true,acceptance:true,withdrawal:true,focusRestored:true,currentInputRetained:true,runtimeErrors:errors.get(page)});
});

test('saved visit survives Google cancellation and return with a freshly revalidated quote',async({page,context},info)=>{
  await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:origin,httpOnly:true,sameSite:'Lax'}]);
  await context.request.post('/api/preferences',{headers:{Origin:origin},data:{optional:true}});
  await page.goto('/');await page.getByRole('radio',{name:/Quiet desks/}).check();
  await page.locator('#resource').click();await page.getByRole('option',{name:/^Quiet desk 02/}).click();
  const resource=await page.locator('#resource').getAttribute('data-value'),date=initialBookingDate(new Date(Date.now()+5*86400000));
  await chooseDate(page,date);await selectChoice(page,'Start time · WAT','10');await selectChoice(page,'Duration','2');
  await page.getByRole('button',{name:'Check availability',exact:true}).click();await page.getByRole('link',{name:'Continue to booking review'}).click();
  await expect(page).toHaveURL(/\/login\?message=booking-required/);
  const next=await page.locator('input[name=next]').inputValue();
  const initiation=await context.request.post('/auth/sign-in',{headers:{Origin:origin},form:{next},maxRedirects:0});expect(initiation.status()).toBe(303);
  await page.goto('/auth/callback?error=access_denied');await expect(page.locator('input[name=next]')).toHaveValue(next);
  await page.getByRole('link',{name:'Keep browsing',exact:true}).click();
  await expect(page.locator('#resource')).toHaveAttribute('data-value',resource!);await expect(page.locator('#date')).toHaveAttribute('data-value',date);await expect(page.locator('#start')).toHaveAttribute('data-value','10');await expect(page.locator('#duration')).toHaveAttribute('data-value','2');
  await expect(page.getByRole('link',{name:'Continue to booking review'})).toHaveCount(0);
  await page.getByRole('button',{name:'Check availability',exact:true}).click();await expect(page.getByLabel('Current visit quote')).toContainText('₦5,000');
  await capture(page,'saved-selection',info);record('saved-selection-'+info.project.name+'.json',{kind:'Actual availability and OAuth initiation; controlled cancellation; no Google round-trip acceptance or booking mutation',selectionRestored:true,quoteRevalidated:true,runtimeErrors:errors.get(page)});
});
