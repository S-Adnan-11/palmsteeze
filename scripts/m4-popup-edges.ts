import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadLocalEnvironment} from './lib/database';
import {createClearance} from '../src/lib/security-sessions';

async function main() {
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New evidence run required');loadLocalEnvironment();
  const output=join(root,'edge-'+(process.argv[3]||'before')+'-'+randomUUID().slice(0,8));mkdirSync(output);
  const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  try {for(const width of [1366,960,390]) {
    const context=await browser.newContext({viewport:{width,height:768},reducedMotion:'no-preference'});
    await context.addInitScript('window.__name=fn=>fn;');
    await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
    await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
    const page=await context.newPage();await page.goto('http://localhost:3000/');await page.evaluate(()=>document.fonts.ready);
    const results=[];
    for(const y of [100,325,420,590,690])for(const id of ['resource','date','start','duration']) {
      const trigger=page.locator('#'+id);await trigger.evaluate((node,y)=>scrollTo({top:scrollY+node.getBoundingClientRect().top-y,behavior:'instant'}),y);await page.waitForTimeout(40);
      await page.evaluate(()=>{
        const frames:unknown[]=[];let running=true;
        function tick(){if(!running)return;const popup=document.querySelector('.brand-popup');frames.push({scrollY,width:document.documentElement.clientWidth,body:document.body.getBoundingClientRect().toJSON(),rect:popup?.getBoundingClientRect().toJSON(),side:popup?.getAttribute('data-side'),visible:popup?getComputedStyle(popup).opacity:null,viewport:popup?.querySelector('[data-radix-select-viewport]')?.getBoundingClientRect().toJSON(),controls:[...document.querySelectorAll('.schedule-grid button[id]')].map(n=>({id:n.id,rect:n.getBoundingClientRect().toJSON()}))});requestAnimationFrame(tick);}
        (window as unknown as {endEdge:()=>unknown[]}).endEdge=()=>{running=false;return frames;};tick();
      });
      await trigger.click();await page.waitForTimeout(350);await page.keyboard.press('Escape');await page.waitForTimeout(180);
      const frames=await page.evaluate(()=>(window as unknown as {endEdge:()=>unknown[]}).endEdge());results.push({id,y,frames});
      const unique=[...new Set((frames as {side:string;rect:unknown}[]).filter(f=>f.rect).map(f=>JSON.stringify({side:f.side,rect:f.rect})))];
      console.log(JSON.stringify({width,id,y,geometries:unique.length,positions:unique}));
    }
    writeFileSync(join(output,`edges-${width}.json`),JSON.stringify(results,null,2),{flag:'wx'});await context.close();
  }}finally{await browser.close();}console.log(output);
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
