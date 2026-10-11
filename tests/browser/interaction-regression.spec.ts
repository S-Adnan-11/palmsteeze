import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createClearance} from '../../src/lib/security-sessions';
import {capture,record,recording} from './targeted-artifacts';

test.use({video:'on'});
const runtimeErrors=new WeakMap<Page,string[]>();
test.beforeEach(async({context,page})=>{
  const errors:string[]=[];runtimeErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource'))errors.push(message.text());});
  await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
  await context.request.post('/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}});
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('.time-feedback')).toHaveText('');
});
test.afterEach(async({page},info)=>{const errors=runtimeErrors.get(page)||[];record(`runtime-${info.title.slice(0,36).replaceAll(' ','-')}-${info.project.name}.json`,{uncaughtAndFrameworkErrors:errors,transportErrors:'Provider/controlled HTTP errors are recorded separately from runtime exceptions'});expect(errors,'uncaught browser errors').toEqual([]);});

type Rect={x:number;y:number;width:number;height:number};
type Frame={scrollY:number;clientWidth:number;body:Rect;controls:Rect[];panel:Rect|null;state:string|null;side:string|null;list:Rect|null};
type ScrollFrame={scene:string|undefined;top:number;opacity:number[]};
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
      if(frame.panel) {
        expect(frame.panel.x).toBeGreaterThanOrEqual(11);expect(frame.panel.y).toBeGreaterThanOrEqual(11);
        expect(frame.panel.x+frame.panel.width).toBeLessThanOrEqual(page.viewportSize()!.width-11);
        expect(frame.panel.y+frame.panel.height).toBeLessThanOrEqual(page.viewportSize()!.height-10);
      }
    }
    const open=frames.filter(frame=>frame.panel&&frame.state==='open');
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
  const audit=await new AxeBuilder({page}).include('.brand-calendar').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations).toEqual([]);
  await capture(page,'transition-calendar-320',info);await page.keyboard.press('Escape');
  record('transitions-'+info.project.name+'.json',{kind:'Frame-by-frame UI regression; visible system scrollbar; test-issued entrance clearance; no provider acceptance',proof});
  await recording(page,'popup-transitions',info);
});

test('workspace scroll progresses forwards and backwards on small desktops',async({page},info)=>{
  const section=page.locator('.workspace-experience');const proof=[];
  if(info.project.name==='desktop') {
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(const {width,height} of [{width:1440,height:1000},{width:1280,height:800},{width:960,height:720},{width:800,height:600}]) {
      await page.setViewportSize({width,height});await expect(section).toHaveAttribute('data-motion','scroll');
      const bounds=await section.evaluate(node=>{
        const sticky=node.querySelector<HTMLElement>('[data-story-panel]')!;
        return {start:scrollY+node.getBoundingClientRect().top-parseFloat(getComputedStyle(sticky).top),travel:node.getBoundingClientRect().height-sticky.offsetHeight};
      });
      await page.evaluate(start=>scrollTo({top:start,behavior:'instant'}),bounds.start);await expect(section.locator('[aria-current="step"]')).toHaveAttribute('data-story-stage','0');
      const link=section.getByRole('link',{name:'Choose your rhythm'});
      const linkBox=(await link.boundingBox())!;
      expect(linkBox.y).toBeGreaterThanOrEqual(0);expect(linkBox.y+linkBox.height).toBeLessThanOrEqual(height);
      const scenePixels:Buffer[]=[];
      for(const [index,progress] of [0,.5,1].entries()) {
        await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),bounds.start+bounds.travel*progress);
        await expect(section.locator('[aria-current="step"]')).toHaveAttribute('data-story-stage',String(index));
        const layer=section.locator('[data-story-scene]').nth(index);
        await expect(layer).toHaveCSS('opacity','1');
        await expect(layer.locator('img')).toHaveJSProperty('complete',true);
        expect(await layer.locator('img').evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const imageBox=(await section.locator('[data-story-visual]').boundingBox())!;
        expect(imageBox.width).toBeGreaterThan(width*.35);expect(imageBox.y).toBeGreaterThanOrEqual(0);expect(imageBox.y+imageBox.height).toBeLessThanOrEqual(height);
        scenePixels.push(await section.locator('[data-story-visual]').screenshot());
        await capture(page,`scene-${width}-${index}`,info);
      }
      expect(scenePixels[0].equals(scenePixels[1])).toBe(false);expect(scenePixels[1].equals(scenePixels[2])).toBe(false);
      await page.evaluate(start=>scrollTo({top:start,behavior:'instant'}),bounds.start);
      const forward:ScrollFrame[]=[],reverse:ScrollFrame[]=[];
      for(const direction of [1,-1])for(let index=0;index<70;index++) {
        await page.mouse.wheel(0,direction*bounds.travel/72);await page.waitForTimeout(35);
        const frame=await section.evaluate(node=>({scene:node.querySelector('[aria-current="step"]')?.getAttribute('data-story-stage')||undefined,top:node.querySelector('[data-story-panel]')!.getBoundingClientRect().top,opacity:[...node.querySelectorAll('[data-story-scene]')].map(layer=>Number(getComputedStyle(layer).opacity))}));
        (direction===1?forward:reverse).push(frame);
      }
      expect([...new Set(forward.map(f=>f.scene))]).toEqual(['0','1','2']);expect([...new Set(reverse.map(f=>f.scene))]).toEqual(['2','1','0']);
      expect(forward.some(f=>f.opacity.some(o=>o>0&&o<1))).toBe(true);
      expect(Math.max(...forward.map(f=>f.top))-Math.min(...forward.map(f=>f.top))).toBeLessThan(2);
      // Entry/exit stay continuous; no scroll interception, layout jump or long blank tail.
      const edges=[];
      for(const y of [bounds.start-16,bounds.start,bounds.start+bounds.travel,bounds.start+bounds.travel+16]) {
        await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await page.waitForTimeout(40);
        edges.push(await section.locator('[data-story-panel]').evaluate(node=>node.getBoundingClientRect().top));
      }
      expect(Math.abs(edges[0]-edges[1]-16)).toBeLessThan(2);expect(Math.abs(edges[2]-edges[3]-16)).toBeLessThan(2);
      await link.click();await expect(page).toHaveURL(/#plan$/);await expect(page.locator('#plan')).toBeInViewport();
      await page.locator('#resource').scrollIntoViewIfNeeded();await expect(page.locator('#resource')).toBeInViewport();
      await capture(page,'scroll-restored-'+width,info);proof.push({width,height,forward,reverse,edges,loadedDistinctScenePixels:true,bookingLinkWithinViewport:true});
    }
    await page.setViewportSize({width:760,height:900});await expect(section).toHaveAttribute('data-motion','static');
    await page.setViewportSize({width:761,height:900});await expect(section).toHaveAttribute('data-motion','scroll');
    await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});await expect(section).toHaveAttribute('data-motion','static');await expect(section.locator('[data-story-visual]')).toBeHidden();
    for(const image of await section.locator('[data-story-static]').all())await expect(image).toBeVisible();
    await section.scrollIntoViewIfNeeded();await capture(page,'scroll-reduced',info);
    await page.emulateMedia({reducedMotion:'no-preference'});await expect(section).toHaveAttribute('data-motion','scroll');
  } else {
    await expect(section).toHaveAttribute('data-motion','static');await expect(section.locator('[data-story-static]').first()).toBeVisible();await section.scrollIntoViewIfNeeded();await capture(page,'scroll-mobile-static',info);
    for(const item of await section.locator('[data-story-stage]').all()){await item.scrollIntoViewIfNeeded();await expect(item).toBeInViewport();}
    await section.getByRole('link',{name:'Choose your rhythm'}).click();await expect(page).toHaveURL(/#plan$/);await expect(page.locator('#plan')).toBeInViewport();
    await page.locator('#resource').scrollIntoViewIfNeeded();await expect(page.locator('#resource')).toBeInViewport();
  }
  record('scroll-restoration-'+info.project.name+'.json',{kind:'Natural wheel input, normal zoom; mobile/reduced-motion fallback retained; not owner or physical-device acceptance',proof});
  await recording(page,'workspace-scroll',info);
});
