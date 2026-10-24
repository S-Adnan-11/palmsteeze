import {chromium,expect,type Page} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync,copyFileSync,constants,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {createClearance} from '../src/lib/security-sessions';

async function main() {
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('Unique evidence run required');
  loadLocalEnvironment();
  const output=join(root,'recordings-'+randomUUID().slice(0,8));mkdirSync(output);mkdirSync(join(output,'raw'));
  const browser=await chromium.launch({channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars'],args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  const proof=[];
  const capture=async(page:Page,name:string)=>writeFileSync(join(output,name+'.png'),await page.screenshot(),{flag:'wx'});
  async function finish(page:Page,name:string) {const video=page.video();await page.close();if(video)copyFileSync(await video.path(),join(output,name+'.webm'),constants.COPYFILE_EXCL);}
  try {
    for(const [mode,viewport,preference] of [
      ['desktop',{width:1440,height:1000},'no-preference'],
      ['desktop-1280',{width:1280,height:800},'no-preference'],
      ['desktop-960',{width:960,height:720},'no-preference'],
      ['desktop-800',{width:800,height:600},'no-preference'],
      ['mobile',{width:390,height:664},'no-preference'],
      ['reduced',{width:1440,height:1000},'reduce'],
      ['owner-normal',{width:1366,height:633},'no-preference'],
      ['owner-reduced',{width:1366,height:633},'reduce'],
    ] as const) {
      if(mode.startsWith('owner-')!==process.argv.includes('--owner-viewport'))continue;
      const mobile=mode==='mobile';
      const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,reducedMotion:preference,recordVideo:{dir:join(output,'raw'),size:viewport}});
      await context.addInitScript('window.__name = fn => fn;');
      await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
      await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
      async function open() {
        const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto('http://localhost:3000');await page.evaluate(()=>document.fonts.ready);await expect(page.locator('#start')).toBeEnabled();await expect(page.locator('.time-feedback')).toHaveText('');
        return {page,errors};
      }
      const {page,errors}=await open(),section=page.locator('.workspace-experience');
      const environment=await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}));
      if(!mobile&&preference==='no-preference') {
        const bounds=await section.evaluate(node=>{const pinned=node.querySelector<HTMLElement>('[data-story-panel]')!;return {start:scrollY+node.getBoundingClientRect().top-parseFloat(getComputedStyle(pinned).top),travel:node.getBoundingClientRect().height-pinned.offsetHeight};});
        await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),bounds.start-viewport.height*.65);await page.waitForTimeout(900);
        const frames=[];
        for(const direction of [1,-1])for(let index=0;index<160;index++) {
          await page.mouse.wheel(0,direction*(bounds.travel+viewport.height*1.3)/160);await page.waitForTimeout(85);
          const frame=await section.evaluate(node=>({y:scrollY,scene:node.querySelector('[aria-current="step"]')?.getAttribute('data-story-stage')||undefined,top:node.querySelector('[data-story-panel]')!.getBoundingClientRect().top,opacity:[...node.querySelectorAll('[data-story-scene]')].map(layer=>Number(getComputedStyle(layer).opacity))}));
          frames.push({direction,...frame});
          if(direction===1&&[40,80,120].includes(index)){await page.waitForTimeout(250);await capture(page,['arrive','settle','gather'][[40,80,120].indexOf(index)]+'-'+mode);}
        }
        proof.push({mode,environment,bounds,frames,runtimeErrors:errors});
      } else {
        await section.evaluate(node=>scrollTo({top:scrollY+node.getBoundingClientRect().top-30,behavior:'instant'}));
        await capture(page,'static-'+mode);await page.waitForTimeout(500);
        for(let index=0;index<32;index++){await page.mouse.wheel(0,30);await page.waitForTimeout(50);}
        for(let index=0;index<32;index++){await page.mouse.wheel(0,-30);await page.waitForTimeout(50);}
        proof.push({mode,environment,fallbackReason:mobile?'CSS viewport is at or below 760px':'prefers-reduced-motion: reduce',runtimeErrors:errors});
      }
      expect(errors).toEqual([]);await finish(page,'story-forward-reverse-'+mode);
      if(preference==='no-preference') {
        const {page:controls,errors:controlErrors}=await open();
        await controls.locator('#resource').evaluate(node=>scrollTo({top:scrollY+node.getBoundingClientRect().top-120,behavior:'instant'}));
        for(const [index,id] of ['resource','date','start','duration'].entries()) {
          const trigger=controls.locator('#'+id);await trigger.click();await expect(controls.locator('.brand-popup')).toBeVisible();await controls.waitForTimeout(450);await capture(controls,'control-'+id+'-'+mode);
          if(id!=='date'){await controls.locator('.brand-select-viewport').hover();await controls.mouse.wheel(0,230);await controls.waitForTimeout(400);await controls.mouse.wheel(0,-230);await controls.waitForTimeout(300);}
          if(index===0||index===3)await controls.keyboard.press('Escape');
          else if(index===1)await controls.mouse.click(3,3);
          else {const box=(await trigger.boundingBox())!;await controls.mouse.click(box.x+10,box.y+10);}
          await expect(controls.locator('.brand-popup')).toHaveCount(0);await expect(trigger).toBeFocused();await controls.waitForTimeout(250);
        }
        expect(controlErrors).toEqual([]);await finish(controls,'controls-'+mode);
      }
      await context.close();
    }
  }finally{await browser.close();}
  writeFileSync(join(output,'recordings.json'),JSON.stringify({at:new Date().toISOString(),buildId:readFileSync('.next/BUILD_ID','utf8').trim(),kind:'Continuous local production recordings. Genuine-key build; trusted test-issued entrance clearance isolates presentation. Explicit media settings are test scenarios only. No test-key footage in this run; no genuine challenge, Google or physical-phone acceptance.',proof},null,2),{flag:'wx'});
  console.log(output);
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
