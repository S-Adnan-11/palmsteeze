import {test,expect} from '@playwright/test';
import {createClearance} from '../../src/lib/security-sessions';

test('local discovery stays ungated and excluded; missing URLs remain real errors',async({request})=>{
  const robots=await request.get('/robots.txt',{maxRedirects:0});
  expect(robots.status()).toBe(200);expect(await robots.text()).toContain('Disallow: /');
  const sitemap=await request.get('/sitemap.xml',{maxRedirects:0});
  expect(sitemap.status()).toBe(200);expect(sitemap.headers()['content-type']).toContain('xml');
  expect(await sitemap.text()).not.toContain('<loc>');
  const missing=await request.get('/definitely-missing-search-audit',{maxRedirects:0});
  expect(missing.status()).toBe(404);expect(missing.headers()['x-robots-tag']).toContain('noindex');
  for(const path of ['/','/verify?overview=1','/privacy','/terms','/cookies']){
    const response=await request.get(path,{maxRedirects:0});expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toContain('noindex');
    expect(await response.text()).toContain('noindex');
  }
  const unavailable=await request.post('/api/verification',{headers:{Origin:'http://localhost:3000'},data:{token:'controlled-provider',next:'/'}});
  expect(unavailable.status()).toBe(503);
});

test('sign-in retains Google profile disclosure and PKCE; cancellation preserves selection',async({page,context})=>{
  await context.addCookies([{name:'ps-clearance',value:createClearance(process.env),url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
  const next='/booking/review?resource=11111111-1111-4111-8111-111111111111&date=2026-11-02&hour=10&duration=1';
  await page.goto('/login?next='+encodeURIComponent(next));
  await expect(page.getByText(/Google shares your name, email address/)).toBeVisible();
  await expect(page.getByRole('link',{name:'Privacy notice',exact:true})).toHaveAttribute('href','/privacy#data');
  const response=await context.request.post('/auth/sign-in',{headers:{Origin:'http://localhost:3000'},form:{next},maxRedirects:0});
  expect(response.status()).toBe(303);
  const url=new URL(response.headers().location);
  expect(url.origin).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
  expect(url.searchParams.get('redirect_to')).toBe('http://localhost:3000/auth/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('s256');
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
  const callback=await context.request.get('/auth/callback?error=access_denied',{maxRedirects:0});
  expect(callback.status()).toBe(303);
  const target=new URL(callback.headers().location,'http://localhost:3000');
  expect(target.origin).toBe('http://localhost:3000');expect(target.searchParams.get('next')).toBe(next);
  await page.goto(target.href);await expect(page.getByRole('button',{name:'Continue with Google'})).toBeEnabled();
});
