import assert from 'node:assert/strict';
import { verifyProject,safeFailure,ReadinessError } from './lib/database';
async function main() {
  await verifyProject();
  const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
  if (origin !== 'http://localhost:3000') throw new ReadinessError('NOT RUN: OAuth start proof is restricted to the configured local M2a origin.');
  const response = await fetch(`${origin}/auth/sign-in`,{method:'POST',redirect:'manual',
    headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({next:'/account'})});
  assert.equal(response.status,303);
  assert.equal(response.headers.get('cache-control')?.includes('no-store'),true);
  const authorization = new URL(response.headers.get('location') || '',origin);
  assert.equal(authorization.origin === process.env.NEXT_PUBLIC_SUPABASE_URL,true);
  assert.equal(authorization.pathname === '/auth/v1/authorize',true);
  assert.equal(authorization.searchParams.get('redirect_to') === `${origin}/auth/callback`,true);
  assert.equal(authorization.searchParams.get('code_challenge_method') === 's256',true);
  assert.equal(Boolean(authorization.searchParams.get('code_challenge')),true);
  assert.equal(response.headers.getSetCookie().some((cookie) => cookie.includes('code-verifier') && /httponly/i.test(cookie)),true);
  const provider = await fetch(authorization,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.equal([302,303].includes(provider.status),true);
  const google = new URL(provider.headers.get('location') || '',authorization);
  assert.equal(google.protocol === 'https:' && google.hostname === 'accounts.google.com',true);
  assert.equal(google.searchParams.get('redirect_uri') === `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`,true);
  const allowed = new Set(['openid','email','profile','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile']);
  const scopes = (google.searchParams.get('scope') || '').split(' ');
  assert.equal(scopes.every((scope) => allowed.has(scope)),true);
  console.log('PASSED: local sign-in starts PKCE with an HttpOnly verifier cookie and redirects through the selected Supabase project to Google with the correct provider callback and basic identity scopes.');
  console.log('NOT RUN: interactive Google authentication and successful return/code exchange; this start proof is not an end-to-end Google login. URLs, cookies, state and credentials not logged.');
}
main().catch(safeFailure);
