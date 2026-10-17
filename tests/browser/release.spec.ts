import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createClearance} from '../../src/lib/security-sessions';
const root=process.env.PALMSTEEZE_RELEASE_ROOT!;
if(!root||!root.startsWith('docs/evidence/m5-release-'))throw new Error('Unique private release evidence root required.');
test.use({trace:'off',screenshot:'off',video:'off'});
test.setTimeout(120000);
async function capture(page:import('@playwright/test').Page,name:string){
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
  await page.evaluate(()=>Promise.all([...document.images].map(img=>{img.loading='eager';return img.decode().catch(()=>{});})));
  expect(await page.evaluate(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
  mkdirSync(root+'/screens',{recursive:true});
  await page.screenshot({path:root+'/screens/'+name+'.png',fullPage:true,animations:'disabled'});
}
test('legal and inline settings remain usable without entrance; consent persists and withdrawal clears both tabs',async({page,context},info)=>{
  await page.route('https://challenges.cloudflare.com/**',route=>route.abort());
  for(const path of ['/privacy','/terms','/cookies']){
    await page.goto(path);await expect(page).toHaveURL('http://localhost:3000'+path);
    await expect(page.getByRole('button',{name:'Cookie settings',exact:true})).toHaveCount(0);
    await capture(page,path.slice(1)+'-'+info.project.name);
  }
  const settings=page.getByRole('group',{name:'Cookie preferences'});
  await expect(settings.getByRole('status')).toContainText('Optional memory is off');
  const checkbox=settings.getByRole('checkbox');await checkbox.check();await settings.getByRole('button',{name:'Save preferences'}).click();
  await expect(settings.getByRole('status')).toContainText('Optional memory is on');
  await expect(settings.getByRole('button',{name:'Save preferences'})).toBeFocused();
  await page.reload();await expect(checkbox).toBeChecked();
  const other=await context.newPage();await other.goto('/cookies');
  await page.evaluate(()=>sessionStorage.setItem('palmsteeze.visit.v1','synthetic draft'));
  await other.evaluate(()=>sessionStorage.setItem('palmsteeze.visit.v1','synthetic draft'));
  await settings.getByRole('button',{name:'Necessary only',exact:true}).click();
  await expect(settings.getByRole('status')).toContainText('Optional memory is off');
  await expect.poll(()=>other.evaluate(()=>sessionStorage.getItem('palmsteeze.visit.v1'))).toBeNull();
  expect(await page.evaluate(()=>sessionStorage.getItem('palmsteeze.visit.v1'))).toBeNull();
  await page.route('**/api/preferences',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Controlled failure'}}):route.continue());
  await checkbox.check();await settings.getByRole('button',{name:'Save preferences'}).click();
  await expect(settings.getByRole('alert')).toContainText('could not be saved');
  await expect(settings.getByRole('status')).toContainText('Optional memory is off');
  await capture(page,'cookie-safe-failure-'+info.project.name);
  const cookie=(await context.cookies()).find(c=>c.name==='ps-preferences');expect(cookie?.httpOnly).toBe(true);
  expect((await context.cookies()).some(c=>c.name==='ps-clearance')).toBe(false);
  await other.close();
});
test('personal story social decoration and all preview sections render across useful widths',async({page,context},info)=>{
  // Trusted test-issued clearance for layout inspection, not genuine provider proof.
  await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
  await context.request.post('/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
  const unexpected:string[]=[];
  for(const width of info.project.name==='desktop'?[1440,1024,768]:[390,360,320]){
    await page.setViewportSize({width,height:900});await page.goto('/portfolio');
    await expect(page.getByRole('heading',{name:'Adnan Muhammad Sadiq'})).toBeVisible();
    await expect(page.locator('.portfolio-intro')).toContainText('asked friends for recommendations');
    const social=page.locator('.footer-socials');await expect(social).toHaveAttribute('aria-hidden','true');
    expect(await social.locator('a,button,[tabindex]').count()).toBe(0);expect(await social.locator('svg').count()).toBe(4);
    await capture(page,`about-${width}`);
    await page.goto('/');await expect(page.locator('.venue-ribbon')).toContainText('Agege, Lagos');
    await capture(page,`home-${width}`);
  }
  await page.goto('/preview/admin');
  page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/api/')&&!['/api/preferences','/api/verification'].includes(path))unexpected.push(path);});
  const sections=page.locator('.workspace-sidebar nav button');const count=await sections.count();expect(count).toBe(6);
  for(let i=0;i<count;i++){await sections.nth(i).click();expect(await page.locator('main form').count()).toBe(0);await capture(page,`preview-${i}-${info.project.name}`);}
  expect(unexpected).toEqual([]);
  await page.goto('/missing-release-page');await expect(page.getByRole('heading',{name:'This page isn’t here.'})).toBeVisible();await capture(page,'not-found-'+info.project.name);
  await page.goto('/portfolio');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  writeFileSync(root+'/rendered-'+info.project.name+'.json',JSON.stringify({kind:'automated Chrome/emulated mobile; trusted test clearance',widths:info.project.name==='desktop'?[1440,1024,768]:[390,360,320],previewSections:count,previewProtectedRequests:unexpected,checkedAxeViolations:0,phone:false,genuineTurnstilePass:false},null,2));
});
