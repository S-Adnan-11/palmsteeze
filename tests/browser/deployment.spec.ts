import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync,writeFileSync } from 'node:fs';

test.use({trace:'off',screenshot:'off',video:'off'});
test('production build preserves public isolation, private caching and canonical auth controls',async ({page,request},info) => {
  const origin = process.env.APP_ORIGIN!;
  expect(origin).toMatch(/^https:\/\//);
  const headers = {Origin:origin,Host:new URL(origin).host};
  const crossOrigin = await request.post('/auth/sign-in',{headers:{...headers,Origin:'https://evil.example'},form:{next:'/account'},maxRedirects:0});
  expect(crossOrigin.status()).toBe(403);
  const spoofed = await request.post('/auth/sign-in',{headers:{...headers,Host:'evil.example'},form:{next:'/account'},maxRedirects:0});
  expect(spoofed.status()).toBe(403);
  const signIn = await request.post('/auth/sign-in',{headers,form:{next:'/account'},maxRedirects:0});
  expect(signIn.status()).toBe(303);
  const authorization = new URL(signIn.headers().location);
  expect(authorization.origin).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
  expect(authorization.searchParams.get('redirect_to')).toBe(`${origin}/auth/callback`);
  expect(signIn.headers()['set-cookie']).toMatch(/HttpOnly/);
  expect(signIn.headers()['set-cookie']).toMatch(/Secure/);
  expect(signIn.headers()['set-cookie']).toMatch(/SameSite=lax/i);
  expect(signIn.headers()['cache-control']).toContain('no-store');
  const unsigned = await request.post('/api/checkout',{headers,data:{}});
  expect(unsigned.status()).toBe(401);
  expect(unsigned.headers()['cache-control']).toContain('no-store');
  const admin = await request.get('/admin',{maxRedirects:0});
  expect([303,307]).toContain(admin.status());
  expect(new URL(admin.headers().location,'http://127.0.0.1:3000').pathname).toBe('/login');
  expect(admin.headers()['cache-control']).toContain('no-store');
  let apiRequests = 0,mutations = 0;
  page.on('request',r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests++;if(r.method()!=='GET') mutations++; });
  await page.context().addCookies([{name:'sb-untrusted-auth-token',value:'untrusted-fixture',domain:'127.0.0.1',path:'/'}]);
  await page.goto('/preview/admin');
  const response = await request.get('/preview/admin');
  expect(response.headers()['set-cookie']).toBeUndefined();
  expect(response.headers()['cache-control']).toContain('no-store');
  await expect(page.locator('.workspace-topbar').getByText('Synthetic · Read-only',{exact:true})).toBeVisible();
  for (const section of ['Bookings','Spaces','Availability','Refunds & recovery','Audit']) {
    await page.getByRole('button',{name:section,exact:true}).click();
    expect(await page.locator('form').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(apiRequests).toBe(0);expect(mutations).toBe(0);
  const axe = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  mkdirSync('docs/screenshots/m5',{recursive:true});mkdirSync('docs/evidence/m5',{recursive:true});
  await page.screenshot({path:`docs/screenshots/m5/production-preview-${info.project.name}.png`,fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');await expect(page.locator('.space-card')).toHaveCount(5);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images,img => {img.loading='eager';return img.decode();}));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/m5/production-home-${info.project.name}.png`,fullPage:true});
  writeFileSync(`docs/evidence/m5/browser-${info.project.name}.json`,JSON.stringify({checkedAt:new Date().toISOString(),status:'PASSED',
    environment:'Local production server with seven-variable hosted configuration; canonical HTTPS headers simulated, no hosted publication.',
    viewport:page.viewportSize(),canonicalAuthRedirect:true,secureHttpOnlySameSiteCookies:true,crossOriginRejected:true,
    anonymousCheckoutAndAdminDenied:true,privateNoStore:true,syntheticPreviewRequests:apiRequests,mutations,
    previewAuthCookieUntouched:true,axeViolations:axe.violations.length,reducedMotionHome:true,physicalPhone:'NOT RUN'},null,2)+'\n');
});
