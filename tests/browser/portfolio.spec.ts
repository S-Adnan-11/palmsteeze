import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectDatabase,verifyProject} from '../../scripts/lib/database';
test.use({trace:'off',screenshot:'off',video:'off'});
test.setTimeout(120000);
test('public presentation is responsive accessible synthetic and read-only',async({page},info)=>{
 await verifyProject();const db=await connectDatabase();let privateIdentifiers:string[];
 try{await db.query('begin read only');const rows=(await db.query("select id::text,email,raw_user_meta_data->>'full_name' as full_name,raw_user_meta_data->>'name' as name from auth.users")).rows;privateIdentifiers=rows.flatMap(r=>[r.id,r.email,r.full_name,r.name].filter(Boolean));await db.query('commit');}finally{await db.end();}
 const requests:{method:string;url:string}[]=[];page.on('request',r=>{if(r.url().includes('/api/'))requests.push({method:r.method(),url:new URL(r.url()).pathname});});
 mkdirSync('docs/screenshots',{recursive:true});const mode=info.project.name;const accessibility:Record<string,number>={};
 async function verify(label:string){
  await page.evaluate(()=>Promise.all(Array.from(document.images,img=>{img.loading='eager';return img.decode().catch(()=>undefined);})));
  expect(await page.evaluate(()=>Array.from(document.images).every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const text=await page.locator('body').innerText();const html=await page.content();for(const value of privateIdentifiers){expect(text.includes(value),'Private identity must not enter public presentation').toBe(false);expect(html.includes(value),'Private identity must not enter page payload').toBe(false);}
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations,`${label} accessibility violations`).toEqual([]);accessibility[label]=axe.violations.length;
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});
  await page.screenshot({path:`docs/screenshots/m4-${label}-${mode}.png`,fullPage:true});
 }
 await page.goto('/');await expect(page.locator('.space-card')).toHaveCount(5);await page.getByRole('button',{name:'Meeting rooms',exact:true}).click();await expect(page.locator('.space-card')).toHaveCount(3);await page.getByRole('button',{name:'All spaces',exact:true}).click();await verify('home');
 await page.goto('/preview/admin');const previewRequests=requests.length;await expect(page.locator('.workspace-topbar').getByText('Synthetic · Read-only',{exact:true})).toBeVisible();await expect(page.getByRole('list',{name:'Synthetic bookings'}).getByRole('listitem')).toHaveCount(4);await verify('preview');
 await page.getByRole('button',{name:'Refunds & recovery',exact:true}).click();await expect(page.getByRole('heading',{name:'A cancelled visit. An unresolved refund.'})).toBeVisible();await expect(page.locator('.demo-outstanding')).toContainText('₦1,000.01');await expect(page.locator('.demo-facts')).toContainText('Stopped');await verify('recovery');
 await page.getByRole('button',{name:'Audit',exact:true}).click();await expect(page.locator('.audit-preview li')).toHaveCount(4);await expect(page.locator('.audit-preview')).toContainText('nia@administrator.example');await verify('audit');
 await page.getByRole('button',{name:'Bookings',exact:true}).click();await page.getByRole('button',{name:'Inspect sample PS-DEMO-105'}).click();await expect(page.getByRole('region',{name:'Selected sample booking'})).toContainText('tomi@customer.example');await expect(page.getByRole('region',{name:'Selected sample booking'})).toContainText('Outstanding balance: ₦0');expect(await page.locator('form').count()).toBe(0);expect(requests.length).toBe(previewRequests);
 const buttons=await page.locator('main').getByRole('button').allTextContents();expect(buttons.some(label=>/approve|reject|refund|retry|settle|save|cancel/i.test(label))).toBe(false);
 await page.goto('/portfolio');await expect(page.getByRole('heading',{name:'One journey. Clear authority.'})).toBeVisible();await verify('architecture');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();await page.keyboard.press('Enter');await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toBe('main');
 expect(requests.filter(r=>r.method!=='GET')).toEqual([]);writeFileSync(`docs/evidence/m4-browser-${mode}.json`,JSON.stringify({checkedAt:new Date().toISOString(),status:'PASSED',browser:'real Chrome',viewport:page.viewportSize(),syntheticPreview:'PASSED — four fictitious records, reserved .example addresses/DEMO IDs; no forms, mutation controls or API requests while navigating sample views',publicIdentityIsolation:'PASSED — live Auth IDs/emails/profile names absent from rendered text and HTML payloads on public captures; identifiers never logged',accessibility,keyboard:'PASSED — skip link and native button navigation',horizontalOverflow:'none',screenshots:`docs/screenshots/m4-*-${mode}.png`,publicHosting:'NOT RUN — M5'},null,2)+'\n');
});
