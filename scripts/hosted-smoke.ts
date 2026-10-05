import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { configuredAppOrigin } from '../src/lib/deployment';
import { ReadinessError,safeFailure } from './lib/database';

async function main() {
  const originIndex = process.argv.indexOf('--origin');
  const value = originIndex >= 0 ? process.argv[originIndex+1] : undefined;
  if (!value) throw new ReadinessError('Supply --origin https://YOUR-STABLE-HOST.vercel.app after publication. This probe creates no records or payments.');
  const origin = configuredAppOrigin({APP_ORIGIN:value,VERCEL:'1'});
  const request = (path:string,init:RequestInit = {}) => fetch(`${origin}${path}`,{
    ...init,redirect:'manual',signal:AbortSignal.timeout(30000),
  });
  const [home,preview,admin] = await Promise.all([request('/'),request('/preview/admin'),request('/admin')]);
  assert.equal(home.status,200);assert.equal(preview.status,200);
  assert.match(await home.text(),/Fictional Lagos workspace/);assert.match(await preview.text(),/Synthetic/);
  for (const response of [home,preview,admin]) assert.match(response.headers.get('cache-control') || '',/no-store/);
  assert.ok([303,307].includes(admin.status));
  assert.equal(new URL(admin.headers.get('location')!,origin).pathname,'/login');
  assert.equal(preview.headers.get('set-cookie'),null);
  const denied = await request('/api/checkout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,401);
  const crossOrigin = await request('/auth/sign-in',{method:'POST',headers:{Origin:'https://untrusted.example'},body:new URLSearchParams({next:'/account'})});
  assert.equal(crossOrigin.status,403);
  const signIn = await request('/auth/sign-in',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({next:'/account'})});
  assert.equal(signIn.status,303);
  const destination = new URL(signIn.headers.get('location')!);
  assert.equal(destination.origin,'https://hjcntuysnzzkddpnulaa.supabase.co');
  assert.equal(destination.searchParams.get('redirect_to'),`${origin}/auth/callback`);
  const cookie = signIn.headers.get('set-cookie') || '';
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=lax/i);
  const report = {checkedAt:new Date().toISOString(),status:'PASSED',origin,tls:'Default certificate and hostname verification enabled.',
    pagesAndPrivateCaching:true,anonymousAdminAndCheckoutDenied:true,canonicalGoogleInitiation:true,
    secureCookies:true,syntheticPreviewNoAuthCookie:true,crossOriginDenied:true,recordsAndPaymentsCreated:0,
    actualGoogleLoginAndCheckoutReturn:'Owner walkthrough still required.',physicalPhone:'NOT RUN'};
  mkdirSync('docs/evidence/m5',{recursive:true});writeFileSync(`docs/evidence/m5/hosted-smoke-${Date.now()}.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
main().catch(safeFailure);
