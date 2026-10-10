import {chromium} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync,copyFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {createClearance} from '../src/lib/security-sessions';

async function main(){
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New run required');loadLocalEnvironment();
  const output=join(root,'final-ui-recordings-'+Date.now()+'-'+randomUUID().slice(0,8));mkdirSync(output);mkdirSync(join(output,'raw'));
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  try{for(const mode of ['desktop','mobile']){
    const viewport=mode==='desktop'?{width:1440,height:1000}:{width:390,height:664};
    const context=await browser.newContext({viewport,isMobile:mode==='mobile',hasTouch:mode==='mobile',reducedMotion:'no-preference',recordVideo:{dir:join(output,'raw'),size:viewport}});
    await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
    const page=await context.newPage();await page.goto('http://localhost:3000/');await page.locator('.workspace-experience').scrollIntoViewIfNeeded();
    if(mode==='desktop')await page.evaluate(`(async()=>{const node=document.querySelector('.workspace-experience'),rect=node.getBoundingClientRect(),start=scrollY+rect.top-innerHeight*.15,end=start+rect.height-innerHeight*.8,began=performance.now();await new Promise(resolve=>{function tick(time){const t=Math.min(1,(time-began)/4500);scrollTo({top:start+(end-start)*t,behavior:'instant'});if(t<1)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});})()`);else await page.waitForTimeout(1200);
    await page.locator('#plan').scrollIntoViewIfNeeded();
    for(const id of ['resource','date','start','duration']){
      const trigger=page.locator('#'+id);await trigger.waitFor();await trigger.click();await page.locator('.brand-popup').waitFor();await page.waitForTimeout(600);writeFileSync(join(output,`${id}-${mode}.png`),await page.screenshot(),{flag:'wx'});
      if(id==='date'){await page.locator('.rdp-selected button').waitFor();await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);await page.keyboard.press('Enter');}else await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
    }
    const video=page.video();await page.close();if(video)copyFileSync(await video.path(),join(output,`controls-${mode}.webm`),constants.COPYFILE_EXCL);await context.close();
  }}finally{await browser.close();}
  writeFileSync(join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),kind:'Final genuine-key UI build; trusted test-issued entrance clearance isolates presentation, no genuine entrance/provider success claim',normalDesktopSequence:true,intentionalMobileStatic:true,sharedControls:true,selectedDayKeyboardSelection:true,physicalPhone:false},null,2),{flag:'wx'});console.log(output);
}
void main().catch(error=>{console.error('UI recording failed: '+error?.name);process.exitCode=1;});
