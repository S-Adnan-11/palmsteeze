import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClearance,validClearance,createPreference,readPreference,securityCookieOptions,signSecurityPayload} from '../../src/lib/security-sessions';
import {entranceDestination,entranceExempt} from '../../src/lib/entrance';
import {verifyTurnstileToken} from '../../src/lib/turnstile-verification';
const env={APP_ORIGIN:'http://localhost:3000',PALMSTEEZE_SECURITY_SECRET:'ab'.repeat(32),NEXT_PUBLIC_TURNSTILE_SITE_KEY:'0x-fixture',TURNSTILE_SECRET_KEY:'fixture'};
const now=Date.now();
test('signed clearance is purpose/origin bound and expires absolutely without trusting client flags',()=>{
  const value=createClearance(env,now);
  assert.equal(validClearance(value,env,now+1799000),true);
  for(const forged of [undefined,'true','verified',value+'x',createPreference(true,env,now),createClearance({...env,APP_ORIGIN:'http://127.0.0.1:3000'},now)])assert.equal(validClearance(forged,env,now),false);
  assert.equal(validClearance(value,env,now+1800000),false);
  assert.equal(validClearance(value,{...env,PALMSTEEZE_SECURITY_SECRET:'cd'.repeat(32)},now),false);
  assert.equal(validClearance(createClearance(env,now+31000),env,now),false);
});
test('preference version and lifetime are separate from clearance and drafts',()=>{
  for(const optional of [false,true])assert.deepEqual(readPreference(createPreference(optional,env,now),env,now),{optional});
  assert.equal(readPreference(createPreference(true,env,now),env,now+180*86400000),null);
  assert.equal(readPreference(createClearance(env,now),env,now),null);
  const old=signSecurityPayload('preferences',{v:1,purpose:'preferences',origin:env.APP_ORIGIN,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+180*86400,optional:true},env);
  assert.equal(readPreference(old,env,now),null);
  assert.deepEqual(securityCookieOptions({...env,APP_ORIGIN:'https://demo.example'},1800),{path:'/',httpOnly:true,sameSite:'lax',secure:true,maxAge:1800});
});
test('entrance destination and asset exceptions do not create alternate-route bypasses',()=>{
  assert.equal(entranceDestination('/booking/new?resource=abc&date=2026-10-19#review'),'/booking/new?resource=abc&date=2026-10-19#review');
  for(const value of ['https://evil.example','//evil.example','/\\evil','/verify?next=/verify','/api/checkout','/auth/callback','/%2f%2fevil','/account%0a'])assert.equal(entranceDestination(value),null);
  for(const path of ['/privacy','/cookies','/terms','/verify','/api/verification','/api/preferences','/auth/callback','/_next/static/a.js','/fonts/manrope.woff','/brand/v2/small-symbol-forest.svg'])assert.equal(entranceExempt(path),true);
  for(const path of ['/','/account','/preview/admin','/api/holds','/api/checkout','/account/file.js','/api/checkout.png','/auth/start','/privacy/private'])assert.equal(entranceExempt(path),false);
});
test('entrance and reservation actions cannot be interchanged at Siteverify',async()=>{
  const fetcher:typeof fetch=async()=>Response.json({success:true,hostname:'localhost',action:'reserve',challenge_ts:new Date(now).toISOString()});
  assert.equal((await verifyTurnstileToken('fixture-token',env,'entrance',fetcher,now)).ok,false);
  assert.equal((await verifyTurnstileToken('fixture-token',env,'reserve',fetcher,now)).ok,true);
});
