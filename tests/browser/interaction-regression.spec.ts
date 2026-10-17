import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createClearance} from '../../src/lib/security-sessions';
import {capture,record,recording} from './targeted-artifacts';

test.use({video:'on'});
const runtimeErrors=new WeakMap<Page,string[]>();
test.beforeEach(async({context,page})=>{
  await context.addInitScript(()=>{
    const enable=()=>{const visual=document.querySelector('[data-story-visual]');if(visual){visual.setAttribute('data-scene-diagnostics','');observer.disconnect();}};
    const observer=new MutationObserver(enable);observer.observe(document,{childList:true,subtree:true});enable();
  });
  const errors:string[]=[];runtimeErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource'))errors.push(message.text());});
  await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  const necessary=page.getByRole('button',{name:'Necessary only',exact:true});
  if(await necessary.isVisible())await necessary.click();
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('.time-feedback')).toHaveText('');
});
test.afterEach(async({page},info)=>{const errors=runtimeErrors.get(page)||[];record(`runtime-${info.title.slice(0,36).replace(/[^a-z0-9-]/gi,'-')}-${info.project.name}.json`,{uncaughtAndFrameworkErrors:errors,transportErrors:'Provider/controlled HTTP errors are recorded separately from runtime exceptions'});expect(errors,'uncaught browser errors').toEqual([]);});

type Rect={x:number;y:number;width:number;height:number};
type Frame={scrollY:number;clientWidth:number;body:Rect;controls:Rect[];panel:Rect|null;state:string|null;side:string|null;list:Rect|null};
async function observeFrames(page:Page) {
  await page.evaluate(()=>{
    const frames:unknown[]=[];let running=true;
    const tick=()=>{
      if(!running)return;
      const rect=(node:Element|null)=>node?{x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}:null;
      const panel=document.querySelector('.brand-popup');
      frames.push({scrollY,clientWidth:document.documentElement.clientWidth,body:rect(document.body),controls:[...document.querySelectorAll('.schedule-grid button[id]')].map(node=>rect(node)),panel:rect(panel),state:panel?.getAttribute('data-state'),side:panel?.getAttribute('data-side'),list:rect(panel?.querySelector('[data-radix-select-viewport]')||null)});
      requestAnimationFrame(tick);
    };
    (window as unknown as {endFrames:()=>unknown[]}).endFrames=()=>{running=false;return frames;};tick();
  });
}

test('popup transitions preserve geometry through open close and list scrolling',async({page},info)=>{
  const proof=[];
  for(const y of [100,Math.round(page.viewportSize()!.height*.6)])for(const id of ['resource','date','start','duration']) {
    const trigger=page.locator('#'+id);
    await trigger.evaluate((node,y)=>scrollTo({top:scrollY+node.getBoundingClientRect().top-y,behavior:'instant'}),y);
    await page.waitForTimeout(60);await observeFrames(page);
    await trigger.click();const panel=page.locator('.brand-popup');await expect(panel).toHaveAttribute('data-state','open');await page.waitForTimeout(180);
    if(id!=='date') {
      const list=page.locator('.brand-select-viewport'),before=await list.boundingBox();
      const contents=await page.locator('.brand-select-item').allTextContents();
      const contentOrigin=()=>list.evaluate(node=>node.querySelector('.brand-select-item')!.getBoundingClientRect().top+node.scrollTop);
      const origin=await contentOrigin();
      await list.hover();await page.mouse.wheel(0,260);await page.waitForTimeout(150);
      const after=await list.boundingBox();expect(after).toEqual(before);
      expect(await page.locator('.brand-select-item').allTextContents()).toEqual(contents);
      expect(Math.abs(await contentOrigin()-origin)).toBeLessThan(1);
      await page.keyboard.press('End');await page.keyboard.press('Home');
    }
    if(y===100)await capture(page,'transition-'+id,info);
    await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
    await page.waitForTimeout(60);
    const frames=await page.evaluate(()=>(window as unknown as {endFrames:()=>Frame[]}).endFrames());
    record(`transition-frames-${id}-${y}-${info.project.name}.json`,frames);
    const first=frames[0];
    for(const frame of frames) {
      // clientWidth includes the browser's scrollbar even with a reserved
      // gutter. Compare actual page geometry through both scrollbar states.
      expect(frame.scrollY).toBe(first.scrollY);
      expect(frame.controls).toEqual(first.controls);expect(frame.body).toEqual(first.body);
      // Radix measures a newly mounted popup entirely above the viewport before
      // positioning it. Check every frame that can actually be seen.
      if(frame.panel&&frame.panel.y+frame.panel.height>0) {
        expect(frame.panel.x).toBeGreaterThanOrEqual(11);expect(frame.panel.y).toBeGreaterThanOrEqual(11);
        expect(frame.panel.x+frame.panel.width).toBeLessThanOrEqual(page.viewportSize()!.width-11);
        expect(frame.panel.y+frame.panel.height).toBeLessThanOrEqual(page.viewportSize()!.height-10);
      }
    }
    const open=frames.filter(frame=>frame.panel&&frame.state==='open'&&frame.panel.y+frame.panel.height>0);
    expect(new Set(open.map(frame=>JSON.stringify(frame.panel))).size).toBe(1);
    expect(new Set(open.map(frame=>frame.side)).size).toBe(1);
    if(id!=='date')expect(new Set(open.map(frame=>JSON.stringify(frame.list))).size).toBe(1);
    proof.push({id,y,frames});
    // Toggle dismissal and switching never select a value or move the document.
    const value=await trigger.getAttribute('data-value');await trigger.click();await expect(panel).toBeVisible();
    const box=(await trigger.boundingBox())!;await page.mouse.click(box.x+10,box.y+10);await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();expect(await trigger.getAttribute('data-value')).toBe(value);
    await trigger.click();await expect(panel).toBeVisible();await page.mouse.click(3,3);await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
  }
  await page.locator('#resource').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(page.locator('.brand-popup')).toHaveCount(0);await expect(page.locator('#resource')).toBeFocused();
  if(info.project.name==='mobile') {
    await page.locator('#start').tap();const box=(await page.locator('.brand-select-viewport').boundingBox())!;
    const session=await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+30,y:box.y+box.height-30}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+30,y:box.y+30}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator('.brand-select-menu')).toBeVisible();await session.detach();await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:320,height:480});await page.locator('#date').click();await expect(page.locator('.brand-calendar')).toBeVisible();
  await expect(page.locator('.brand-calendar')).toHaveCSS('opacity','1');
  const audit=await new AxeBuilder({page}).include('.brand-calendar').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations).toEqual([]);
  await capture(page,'transition-calendar-320',info);await page.keyboard.press('Escape');
  record('transitions-'+info.project.name+'.json',{kind:'Frame-by-frame UI regression; visible system scrollbar; test-issued entrance clearance; no provider acceptance',proof});
  await recording(page,'popup-transitions',info);
});

// Registers the shared single-stage story checks with the setup above.
import './workspace-story';
