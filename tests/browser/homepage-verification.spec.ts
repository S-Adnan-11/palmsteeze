import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync} from 'node:fs';
import {createClearance} from '../../src/lib/security-sessions';

const root=process.env.PALMSTEEZE_RELEASE_ROOT;
test.use({trace:'off',video:'off',screenshot:'off'});

test('anonymous homepage explains the demo without JavaScript or clearance',async({browser,request},info)=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:info.project.use.viewport});
  try {
    const page=await context.newPage();const response=await page.goto('http://localhost:3000/');
    expect(response?.status()).toBe(200);expect(response?.headers().location).toBeUndefined();
    await expect(page.getByRole('heading',{name:'Welcome to PalmSteeze.',exact:true})).toBeVisible();
    await expect(page.locator('.entrance-overview')).toContainText('test bookings');
    await page.getByText('About PalmSteeze',{exact:true}).click();
    await expect(page.locator('.entrance-about')).toContainText('booking and refund history');
    await expect(page.getByRole('link',{name:'Privacy',exact:true})).toHaveAttribute('href','/privacy');
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',/^https:\/\/palmsteeze\.devs\.surf\/?$/);
    expect(await page.locator('.rhythm-hero').count()).toBe(0);
    expect((await context.cookies()).some(c=>c.name==='ps-clearance')).toBe(false);
    const verifier=await request.get('/',{headers:{'User-Agent':'Google-Site-Verification/1.0'},maxRedirects:0});
    expect(verifier.status()).toBe(200);expect(await verifier.text()).toContain('About PalmSteeze');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    if(root){mkdirSync(root+'/screenshots',{recursive:true});await page.screenshot({path:root+'/screenshots/no-js-'+info.project.name+'.png',fullPage:true});}
    for(const path of ['/account','/admin','/booking/review','/preview/admin']){
      const protectedResponse=await request.get(path,{maxRedirects:0});expect(protectedResponse.status()).toBe(307);
      expect(new URL(protectedResponse.headers().location,'http://localhost:3000').pathname).toBe('/verify');
    }
    for(const path of ['/','/api/holds','/api/checkout']){
      const denied=await request.post(path,{headers:{Origin:'http://localhost:3000'},data:{}});expect(denied.status()).toBe(403);
    }
  } finally {await context.close();}
});

test('failed challenge delivery leaves public overview and legal links usable',async({page,context},info)=>{
  await page.route('https://challenges.cloudflare.com/**',route=>route.abort());
  await page.goto('/');await expect(page.locator('.entrance-overview')).toBeVisible();
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  for(const width of info.project.name==='mobile'?[390,320]:[1440,768]){
    await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  }
  const scan=await new AxeBuilder({page}).analyze();expect(scan.violations).toEqual([]);
  await page.getByRole('link',{name:'Privacy',exact:true}).click();await expect(page).toHaveURL('http://localhost:3000/privacy');
  expect((await context.cookies()).some(c=>c.name==='ps-clearance')).toBe(false);
});

test('controlled valid clearance retains the approved full homepage',async({page,context})=>{
  // Purpose-bound test-issued cookie proves routing only, not provider success.
  await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
  await page.goto('/');await expect(page.locator('#hero-title')).toBeVisible();
  expect(await page.locator('.entrance-overview').count()).toBe(0);
  await expect(page.locator('.venue-ribbon')).toContainText('Agege, Lagos');
});
