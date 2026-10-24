import {expect,type BrowserContext,type Page} from '@playwright/test';
export async function setOptionalMemory(page:Page,optional:boolean) {
  const settings=await page.context().newPage();
  try {
    await settings.goto('/cookies');
    const group=settings.getByRole('group',{name:'Cookie preferences'});
    await group.getByRole('checkbox').setChecked(optional);
    await group.getByRole('button',{name:'Save preferences'}).click();
    await expect(group.getByRole('status')).toContainText(optional?'Optional memory is on.':'Optional memory is off.');
  } finally {await settings.close();await page.bringToFront();}
}
export async function ensureEntrance(context:BrowserContext) {
  if((await (await context.request.get('http://localhost:3000/api/verification')).json()).verified)return;
  const page=await context.newPage();try{await page.goto('http://localhost:3000/verify?next=/');await expect(page).toHaveURL('http://localhost:3000/',{timeout:30000});}finally{await page.close();}
  expect((await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}})).status()).toBe(200);
}
export async function waitForReservationSecurity(page:Page) {
  await page.getByRole('region',{name:'Reservation security'}).scrollIntoViewIfNeeded();
  // Reservation verification executes on the protected action, not on arrival.
  await expect(page.getByRole('region',{name:'Reservation security'})).toHaveAttribute('data-state',/idle|ready|loading|success/);
}
export async function reservationHeaders(context:BrowserContext,destination:string) {
  const page=await context.newPage();
  try {
    await page.goto(destination);
    if(process.env.PALMSTEEZE_TURNSTILE_TEST_MODE!=='true')throw new Error('Direct API regression tokens require explicit official loopback test keys; no genuine challenge success inferred.');
    const sitekey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;
    const token=await page.evaluate(async sitekey=>{
      if(!window.turnstile)await new Promise<void>((resolve,reject)=>{
        const scope=window as typeof window & {palmsteezeProofLoaded?:()=>void};
        scope.palmsteezeProofLoaded=()=>{delete scope.palmsteezeProofLoaded;resolve();};
        const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=palmsteezeProofLoaded';script.onerror=()=>reject(new Error('Official test widget unavailable'));document.head.appendChild(script);
      });
      return new Promise<string>((resolve,reject)=>{
        const node=document.createElement('div');document.body.appendChild(node);
        const timer=setTimeout(()=>reject(new Error('Official test widget timed out')),30000);
        window.turnstile!.render(node,{sitekey,action:'reserve',execution:'render',callback:(token:string)=>{clearTimeout(timer);resolve(token);},'error-callback':()=>{clearTimeout(timer);reject(new Error('Official test widget failed'));}});
      });
    },sitekey);
    return {'X-Turnstile-Token':token};
  } finally {await page.close();}
}
