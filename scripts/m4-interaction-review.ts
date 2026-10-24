import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {mkdirSync,existsSync,writeFileSync,copyFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {createClearance} from '../src/lib/security-sessions';

async function main() {
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New evidence run required');loadLocalEnvironment();
  const output=join(root,'review-'+randomUUID().slice(0,8));mkdirSync(output);mkdirSync(join(output,'raw'));
  const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  async function open(context:BrowserContext) {
    const page=await context.newPage();await page.goto('http://localhost:3000/');await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator('#start')).toBeEnabled();await expect(page.locator('.time-feedback')).toHaveText('');return page;
  }
  async function capture(page:Page,name:string) {writeFileSync(join(output,name+'.png'),await page.screenshot(),{flag:'wx'});}
  async function finish(page:Page,name:string) {const video=page.video();await page.close();if(video)copyFileSync(await video.path(),join(output,name+'.webm'),constants.COPYFILE_EXCL);}
  try {
    for(const [mode,viewport] of [['desktop',{width:1440,height:900}],['small-desktop',{width:960,height:900}],['mobile',{width:390,height:664}]] as const) {
      const mobile=mode==='mobile';
      const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,reducedMotion:'no-preference',recordVideo:{dir:join(output,'raw'),size:viewport}});
      await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
      await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
      const page=await open(context),section=page.locator('.workspace-experience');
      if(!mobile) {
        const bounds=await section.evaluate(node=>{const pinned=node.querySelector<HTMLElement>('.experience-sticky')!;return {start:scrollY+node.getBoundingClientRect().top-parseFloat(getComputedStyle(pinned).top),travel:node.getBoundingClientRect().height-pinned.offsetHeight};});
        await page.evaluate(start=>scrollTo({top:start,behavior:'instant'}),bounds.start);await page.waitForTimeout(250);await capture(page,'arrive-'+mode);
        for(let index=1;index<=72;index++) {
          await page.mouse.wheel(0,bounds.travel/72);await page.waitForTimeout(40);
          if(index===36){await expect(section).toHaveAttribute('data-scene','1');await page.waitForTimeout(200);await capture(page,'settle-'+mode);}
        }
        await expect(section).toHaveAttribute('data-scene','2');await page.waitForTimeout(250);await capture(page,'gather-'+mode);
      } else {await section.scrollIntoViewIfNeeded();await page.waitForTimeout(350);await capture(page,'static-'+mode);}
      await finish(page,'workspace-'+mode);
      const controls=await open(context);
      await controls.locator('#resource').evaluate((node,y)=>scrollTo({top:scrollY+node.getBoundingClientRect().top-y,behavior:'instant'}),mobile?100:160);
      for(const id of ['resource','date','start','duration']) {
        const trigger=controls.locator('#'+id),box=(await trigger.boundingBox())!;
        await controls.mouse.click(box.x+box.width-15,box.y+24);await expect(controls.locator('.brand-popup')).toBeVisible();await controls.waitForTimeout(400);await capture(controls,id+'-'+mode);
        if(id==='start'){await controls.locator('.brand-select-viewport').hover();await controls.mouse.wheel(0,230);await controls.waitForTimeout(450);}
        await controls.mouse.click(box.x+box.width-15,box.y+24);await expect(controls.locator('.brand-popup')).toHaveCount(0);await controls.waitForTimeout(200);
      }
      await finish(controls,'controls-'+mode);await context.close();
    }
  } finally {await browser.close();}
  writeFileSync(join(output,'review.json'),JSON.stringify({at:new Date().toISOString(),kind:'Actual local production browser recordings; natural wheel input; visible scrollbar; trusted test-issued entrance clearance isolates UI. No provider or physical-device acceptance inferred.',viewports:[1440,960,390],motionBreakpoint:761,reducedMotionRespected:true},null,2),{flag:'wx'});
  console.log(output);
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
