import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {configuredAppOrigin} from '../src/lib/deployment';
import {ReadinessError,safeFailure} from './lib/database';

async function main() {
  const index=process.argv.indexOf('--origin');
  if(index<0||!process.argv[index+1])throw new ReadinessError('Supply --origin https://palmsteeze.devs.surf after publication.');
  const origin=configuredAppOrigin({APP_ORIGIN:process.argv[index+1],VERCEL:'1'});
  const request=(path:string,init:RequestInit={})=>fetch(origin+path,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)});
  for(const path of ['/','/account','/admin','/preview/admin','/portfolio']) {
    const response=await request(path);assert.equal(response.status,307);
    const destination=new URL(response.headers.get('location')!,origin);
    assert.equal(destination.origin,origin);assert.equal(destination.pathname,'/verify');
    assert.match(response.headers.get('cache-control')||'',/no-store/);
  }
  for(const path of ['/verify','/privacy','/cookies','/terms']) {
    const response=await request(path);assert.equal(response.status,200);
    const body=await response.text();assert.match(body,/PalmSteeze/);
    if(path==='/cookies')assert.match(body,/Save preferences/);
    if(path==='/privacy')assert.match(body,/s\.adnan\.werk@gmail\.com/);
  }
  const denied=await request('/api/checkout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,403);assert.equal((await denied.json()).entranceRequired,true);
  const foreign=await request('/api/preferences',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({optional:false})});
  assert.equal(foreign.status,403);
  const preferences=await request('/api/preferences',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({optional:false})});
  assert.equal(preferences.status,200);
  const cookie=preferences.headers.get('set-cookie')||'';
  for(const flag of [/HttpOnly/i,/Secure/i,/SameSite=lax/i,/Max-Age=15552000/i])assert.match(cookie,flag);
  assert.doesNotMatch(cookie,/Domain=/i);
  const callback=await request('/auth/callback?error=access_denied');assert.equal(callback.status,303);
  assert.equal(new URL(callback.headers.get('location')!,origin).origin,origin);
  const invalid=await request('/api/verification',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:'invalid-release-probe',next:'/account'})});
  assert.equal(invalid.status,403);assert.doesNotMatch(invalid.headers.get('set-cookie')||'',/ps-clearance=/);
  for(const path of ['/brand/v2/favicon.svg','/brand/v2/open-graph.png','/art/workspace-video/workspace-mobile-poster.webp','/licenses/third-party-notices.txt','/licenses/simple-icons-CC0.txt','/licenses/three-MIT.txt','/licenses/animejs-MIT.txt'])assert.equal((await request(path)).status,200);
  const movie=await request('/art/workspace-video/workspace-mobile.mp4',{headers:{Range:'bytes=0-1023'}});
  assert.equal(movie.status,206);assert.match(movie.headers.get('content-range')||'',/^bytes 0-1023\//);
  const report={checkedAt:new Date().toISOString(),origin,status:'PASSED',tls:'Certificate and hostname verification enabled',entranceEnforced:true,legalAndSettingsUngated:true,secureHostOnlyPreferences:true,cancelledCallbackSameOrigin:true,invalidGenuineVerificationRejected:true,assetsAndVideoRange:true,recordsAndPaymentsCreated:0,limits:'No successful genuine challenge, complete Google login, authenticated hosted customer/admin view, signed payment delivery or physical-phone proof in this probe.'};
  mkdirSync('docs/evidence/m5',{recursive:true});
  writeFileSync(`docs/evidence/m5/hosted-smoke-${Date.now()}.json`,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
}
main().catch(safeFailure);
