const {chromium}=require('@playwright/test');
const {createHmac,randomUUID}=require('node:crypto');
const {mkdirSync,writeFileSync,existsSync}=require('node:fs');
const {resolve}=require('node:path');
async function main(){
  const root=resolve(process.argv[2]||'');
  if(!root.includes('m4-targeted-')||!existsSync(root+'/run.json'))throw Error('New run directory required');
  const out=root+'/baseline';mkdirSync(out);
  process.loadEnvFile('.env.local');
  const iat=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({v:1,purpose:'clearance',origin:'http://localhost:3000',iat,exp:iat+1800,nonce:randomUUID()})).toString('base64url');
  const value=payload+'.'+createHmac('sha256',process.env.PALMSTEEZE_SECURITY_SECRET).update('palmsteeze-clearance-v1.'+payload).digest('hex');
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addCookies([{name:'ps-clearance',value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();await page.goto('http://localhost:3000');await page.waitForTimeout(1500);
    const data={kind:'baseline against existing local server; trusted test-issued clearance, no genuine Turnstile claim',motion:await page.evaluate(()=>({width:innerWidth,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,mode:document.querySelector('.workspace-experience')?.dataset.motion,bodyOverflow:getComputedStyle(document.body).overflowX,htmlOverflow:getComputedStyle(document.documentElement).overflowX}))};
    await page.getByRole('button',{name:'Necessary only',exact:true}).click();
    for(const preference of ['no-preference','reduce']){
      await page.emulateMedia({reducedMotion:preference});await page.locator('.workspace-experience').scrollIntoViewIfNeeded();await page.waitForTimeout(300);
      data[preference]=await page.locator('.workspace-experience').evaluate(n=>({mode:n.dataset.motion,height:n.getBoundingClientRect().height,sticky:getComputedStyle(n.querySelector('.experience-sticky')).position,images:getComputedStyle(n.querySelector('.experience-images')).display}));
      await page.screenshot({path:out+'/motion-'+preference+'.png'});
    }
    await page.locator('#plan').scrollIntoViewIfNeeded();
    async function metrics(){return page.evaluate(()=>({scrollY,clientWidth:document.documentElement.clientWidth,body:document.body.getBoundingClientRect().toJSON(),controls:[...document.querySelectorAll('.schedule-grid .brand-select-trigger,#space')].map(n=>({id:n.id,rect:n.getBoundingClientRect().toJSON()}))}));}
    data.popups=[];
    for(const label of ['Your space','Date','Start time · WAT','Duration']){
      const trigger=page.getByRole(label==='Your space'||label==='Start time · WAT'||label==='Duration'?'combobox':'button',{name:label,exact:true});
      await trigger.scrollIntoViewIfNeeded();const before=await metrics();await trigger.click();await page.waitForTimeout(500);const opened=await metrics();
      await page.screenshot({path:out+'/popup-'+label.replace(/[^a-z]+/gi,'-')+'.png'});await page.keyboard.press('Escape');await page.waitForTimeout(250);const after=await metrics();
      data.popups.push({label,before,opened,after});
    }
    writeFileSync(out+'/diagnostic.json',JSON.stringify(data,null,2),{flag:'wx'});console.log(JSON.stringify({motion:data.motion,normal:data['no-preference'],reduced:data.reduce,popups:data.popups.map(x=>({label:x.label,scroll:[x.before.scrollY,x.opened.scrollY,x.after.scrollY],width:[x.before.clientWidth,x.opened.clientWidth,x.after.clientWidth],bodyX:[x.before.body.x,x.opened.body.x,x.after.body.x]}))}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
