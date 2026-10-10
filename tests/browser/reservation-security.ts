import {expect,type BrowserContext,type Page} from '@playwright/test';
export async function ensureEntrance(context:BrowserContext) {
  if((await (await context.request.get('http://localhost:3000/api/verification')).json()).verified)return;
  const page=await context.newPage();try{await page.goto('http://localhost:3000/verify?next=/');await expect(page).toHaveURL('http://localhost:3000/',{timeout:30000});}finally{await page.close();}
  expect((await context.request.post('http://localhost:3000/api/preferences',{headers:{Origin:'http://localhost:3000'},data:{optional:false}})).status()).toBe(200);
}
export async function waitForReservationSecurity(page:Page) {
  await page.getByRole('region',{name:'Reservation security'}).scrollIntoViewIfNeeded();
  await expect(page.locator('#security-status')).toContainText('Security check complete.',{timeout:30000});
}
export async function reservationHeaders(context:BrowserContext,destination:string) {
  const page=await context.newPage();
  try {
    await page.goto(destination);await waitForReservationSecurity(page);
    const token=await page.evaluate(()=>(window.turnstile as unknown as {getResponse:()=>string}).getResponse());
    return {'X-Turnstile-Token':token};
  } finally {await page.close();}
}
