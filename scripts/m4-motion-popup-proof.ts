import {chromium} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync,copyFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {createClearance} from '../src/lib/security-sessions';

async function main() {
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New evidence run required');
  loadLocalEnvironment();const label=process.argv[3]||'baseline';
  const output=join(root,label+'-'+randomUUID().slice(0,8));mkdirSync(output);mkdirSync(join(output,'raw'));
  const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  try {
    for(const viewport of [{width:1280,height:800},{width:960,height:720},{width:390,height:664}]) {
      const mobile=viewport.width<760,mode=String(viewport.width);
      const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,reducedMotion:'no-preference',recordVideo:{dir:join(output,'raw'),size:viewport}});
      // tsx preserves names in serialized diagnostic callbacks; browser helper
      // only, with no application behavior or provider replacement.
      await context.addInitScript('window.__name = fn => fn;');
      await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
      await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
      const page=await context.newPage();await page.goto('http://localhost:3000/');await page.evaluate(()=>document.fonts.ready);
      const motion=await page.locator('.workspace-experience').evaluate(async node=>{
        const steps=[];
        const rect=node.getBoundingClientRect(),start=scrollY+rect.top-innerHeight*.15,distance=rect.height-innerHeight*.8;
        for(let index=0;index<=80;index++) {
          scrollTo({top:start+distance*index/80,behavior:'instant'});await new Promise(requestAnimationFrame);
          const sticky=node.querySelector('.experience-sticky')!;
          steps.push({y:scrollY,scene:(node as HTMLElement).dataset.scene,stickyTop:sticky.getBoundingClientRect().top,opacity:[...node.querySelectorAll('.experience-layer')].map(layer=>getComputedStyle(layer).opacity)});
        }
        return {mode:(node as HTMLElement).dataset.motion,width:innerWidth,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,steps};
      });
      const transitions=[];
      for(const id of ['resource','date','start','duration']) {
        await page.locator('#'+id).waitFor({state:'visible'});
        await page.locator('#'+id).evaluate(node=>scrollTo({top:scrollY+node.getBoundingClientRect().top-(innerHeight>700?280:200),behavior:'instant'}));
        await page.waitForTimeout(250);
        await page.evaluate(()=>{
          const samples:unknown[]=[];let active=true;
          const tick=()=>{
            if(!active)return;
            const rect=(node:Element|null)=>node?.getBoundingClientRect().toJSON();
            const popup=document.querySelector('.brand-popup');
            samples.push({time:performance.now(),scrollY,innerWidth,clientWidth:document.documentElement.clientWidth,bodyStyle:document.body.getAttribute('style'),bodyRect:rect(document.body),focus:document.activeElement?.id,controls:[...document.querySelectorAll('.schedule-grid .brand-select-trigger')].map(node=>({id:node.id,rect:rect(node)})),popup:popup?{rect:rect(popup),side:popup.getAttribute('data-side'),state:popup.getAttribute('data-state'),opacity:getComputedStyle(popup).opacity,scroll:popup.querySelector('[data-radix-select-viewport]')?.scrollTop}:null});
            requestAnimationFrame(tick);
          };
          (window as unknown as {endPopupProof:()=>unknown[]}).endPopupProof=()=>{active=false;return samples;};tick();
        });
        const trigger=page.locator('#'+id),box=(await trigger.boundingBox())!;
        await page.mouse.click(box.x+box.width-15,box.y+box.height/2);await page.waitForTimeout(500);
        writeFileSync(join(output,`${mode}-${id}.png`),await page.screenshot(),{flag:'wx'});
        if(id==='start'){await page.locator('.brand-select-viewport').hover();await page.mouse.wheel(0,280);await page.waitForTimeout(250);}
        await page.keyboard.press('Escape');await page.waitForTimeout(400);
        await page.mouse.click(box.x+box.width-15,box.y+box.height/2);await page.waitForTimeout(250);
        await page.mouse.click(box.x+box.width-15,box.y+box.height/2);await page.waitForTimeout(250);
        await page.keyboard.press('Escape');await page.waitForTimeout(200);
        transitions.push({id,frames:await page.evaluate(()=>(window as unknown as {endPopupProof:()=>unknown[]}).endPopupProof())});
      }
      writeFileSync(join(output,`metrics-${mode}.json`),JSON.stringify({kind:'Presentation only; test-issued entrance clearance, no provider claim',viewport,motion,transitions},null,2),{flag:'wx'});
      const video=page.video();await page.close();if(video)copyFileSync(await video.path(),join(output,`motion-controls-${mode}.webm`),constants.COPYFILE_EXCL);await context.close();
      console.log(JSON.stringify({mode,motion:motion.mode,scenes:[...new Set(motion.steps.map(step=>step.scene))],transitions:transitions.map(t=>{const f=t.frames as {clientWidth:number;scrollY:number;controls:{id:string;rect:{x:number;y:number;width:number}}[];popup:{rect:{x:number;y:number;width:number;height:number};side:string}|null}[];return {id:t.id,clientWidths:[...new Set(f.map(s=>s.clientWidth))],scroll:[...new Set(f.map(s=>s.scrollY))],triggerPositions:[...new Set(f.map(s=>JSON.stringify(s.controls.find(c=>c.id===t.id)?.rect)))],panels:[...new Set(f.filter(s=>s.popup).map(s=>JSON.stringify(s.popup)))]};})}));
    }
  } finally {await browser.close();}
  console.log(output);
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
