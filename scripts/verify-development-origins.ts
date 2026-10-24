// Controlled HTTP checks against the local server using exact external headers.
// Signed test-issued clearance exercises routing; it is NOT genuine Turnstile acceptance.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {developmentOrigins} from '../src/lib/deployment';
import {createClearance} from '../src/lib/security-sessions';
import {visitDestination} from '../src/lib/auth/destinations';

process.loadEnvFile('.env.local');
const results:Record<string,unknown>[]=[];
const evidence=process.env.PALMSTEEZE_ORIGIN_EVIDENCE||'docs/evidence/m4-tunnel-20261016';
function send(origin:string,path:string,options:{method?:string;headers?:Record<string,string>;body?:string}={}) {
  return new Promise<{status:number;headers:http.IncomingHttpHeaders;body:string}>((resolve,reject)=>{
    const req=http.request('http://localhost:3000'+path,{method:options.method||'GET',headers:{Host:new URL(origin).host,'X-Forwarded-Proto':new URL(origin).protocol.slice(0,-1),...options.headers}},res=>{
      const chunks:Buffer[]=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.setTimeout(60000,()=>req.destroy(new Error('Local check timed out')));req.on('error',reject);req.end(options.body);
  });
}
async function main() {
  for(const origin of developmentOrigins) {
    const path='/booking/new?resource=00000000-0000-4000-8000-000000000025&date=2026-10-19&hour=10&duration=2';
    const entry=await send(origin,path);
    assert.equal(entry.status,307);
    const redirect=new URL(entry.headers.location!,origin);
    assert.equal(redirect.origin,origin);assert.equal(redirect.pathname,'/verify');assert.equal(redirect.searchParams.get('next'),path);
    const verify=await send(origin,redirect.pathname+redirect.search);assert.equal(verify.status,200);
    assert.ok(verify.body.includes('challenges.cloudflare.com')||verify.body.includes('SecurityChallenge')||verify.body.includes('security'));
    const script=verify.body.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/)?.[1];assert.ok(script);
    const asset=await send(origin,script,{headers:{Origin:origin}});assert.equal(asset.status,200);
    const video=await send(origin,'/art/workspace-video/workspace-mobile.mp4',{headers:{Range:'bytes=0-63'}});
    assert.equal(video.status,206);assert.match(String(video.headers['content-type']),/video\/mp4/);assert.match(String(video.headers['content-range']),/^bytes 0-63\//);
    const headers={Origin:origin,'Content-Type':'application/json'};
    const missing=await send(origin,'/api/verification',{method:'POST',headers,body:JSON.stringify({token:'',next:path})});
    assert.equal(missing.status,403);assert.equal(missing.headers['set-cookie'],undefined);
    const invalid=await send(origin,'/api/verification',{method:'POST',headers,body:JSON.stringify({token:'invalid-controlled-token',next:path})});
    assert.equal(invalid.status,403);assert.equal(invalid.headers['set-cookie'],undefined);
    for(const next of ['https://evil.example','//evil.example','/booking/../account','/auth/callback','/verify?next=/']) {
      const unsafe=await send(origin,'/api/verification',{method:'POST',headers,body:JSON.stringify({token:'invalid',next})});assert.equal(unsafe.status,400);
    }
    const cookie='ps-clearance='+createClearance(process.env,Date.now(),origin);
    const cleared=await send(origin,'/api/verification',{headers:{Cookie:cookie}});assert.deepEqual(JSON.parse(cleared.body),{verified:true});
    const otherCookie='ps-clearance='+createClearance(process.env,Date.now(),developmentOrigins.find(value=>value!==origin)!);
    const cross=await send(origin,'/api/verification',{headers:{Cookie:otherCookie}});assert.deepEqual(JSON.parse(cross.body),{verified:false});
    const home=await send(origin,'/',{headers:{Cookie:cookie}});assert.equal(home.status,200);
    for(const path of ['/account','/admin']) {
      const customer=await send(origin,path,{headers:{Cookie:cookie}});
      assert.equal(customer.status,307,path);const login=new URL(customer.headers.location!,origin);
      assert.equal(login.origin,origin);assert.equal(login.pathname,'/login');
    }
    const review=await send(origin,'/booking/review?resource=00000000-0000-4000-8000-000000000025&date=2026-10-19&hour=10&duration=2',{headers:{Cookie:cookie}});
    // Next can stream a Server Component redirect as a relative refresh tag.
    if(review.status===307) {
      const destination=new URL(review.headers.location!,origin);assert.equal(destination.origin,origin);assert.equal(destination.pathname,'/login');
    } else {
      assert.equal(review.status,200);assert.ok(review.body.includes('/login?message=booking-required'));
    }
    const signedOut=await send(origin,'/auth/sign-out',{method:'POST',headers:{Origin:origin,Cookie:cookie}});
    assert.equal(signedOut.status,303);assert.equal(new URL(signedOut.headers.location!,origin).origin,origin);
    const preference=await send(origin,'/api/preferences',{method:'POST',headers,body:'{"optional":false}'});assert.equal(preference.status,200);
    const preferenceCookie=preference.headers['set-cookie']?.find(value=>value.startsWith('ps-preferences='));assert.ok(preferenceCookie);
    assert.equal(/; Secure/i.test(preferenceCookie),origin.startsWith('https:'));assert.equal(/; Domain=/i.test(preferenceCookie),false);
    const saved=visitDestination({resource:'00000000-0000-4000-8000-000000000025',date:'2026-10-19',hour:10,duration:2});
    const oauth=await send(origin,'/auth/sign-in',{method:'POST',headers:{Origin:origin,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body:new URLSearchParams({next:saved}).toString()});
    assert.equal(oauth.status,200);
    const provider=new URL(JSON.parse(oauth.body).url);assert.equal(provider.origin,process.env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(provider.searchParams.get('redirect_to'),origin+'/auth/callback');
    const authCookies=oauth.headers['set-cookie']||[];assert.ok(authCookies.some(value=>value.startsWith('ps-oauth-next=')));assert.ok(authCookies.some(value=>value.startsWith('sb-')));
    for(const value of authCookies) {assert.equal(/; Domain=/i.test(value),false);assert.equal(/; Secure/i.test(value),origin.startsWith('https:'));assert.match(value,/; HttpOnly/i);assert.match(value,/; SameSite=lax/i);}
    const savedCookie=authCookies.map(value=>value.split(';')[0]).join('; ');
    const cancel=await send(origin,'/auth/callback?error=access_denied',{headers:{Cookie:savedCookie}});assert.equal(cancel.status,303);
    const retry=new URL(cancel.headers.location!,origin);assert.equal(retry.origin,origin);assert.equal(retry.pathname,'/login');assert.equal(retry.searchParams.get('next'),saved);assert.equal(retry.searchParams.get('message'),'cancelled');
    const forged=await send(origin,'/auth/callback?code=invalid&next=https://evil.example',{headers:{Cookie:savedCookie}});
    assert.equal(forged.status,303);assert.equal(new URL(forged.headers.location!,origin).origin,origin);assert.equal(new URL(forged.headers.location!,origin).searchParams.get('message'),'invalid-callback');
    for(const path of ['/api/holds','/api/checkout','/api/admin/actions','/auth/sign-in','/auth/sign-out','/api/preferences']) {
      const rejected=await send(origin,path,{method:'POST',headers:{...headers,Origin:developmentOrigins.find(value=>value!==origin)!,Cookie:cookie},body:'{}'});assert.equal(rejected.status,403,path);
    }
    const noAccount=await send(origin,'/api/holds',{method:'POST',headers:{...headers,Cookie:cookie},body:'{}'});assert.equal(noAccount.status,401);
    results.push({origin,entryRedirect:redirect.toString(),verificationPage:200,devAsset:200,videoRange:206,missingAndInvalidTokensRejected:true,unsafeDestinationsRejected:true,crossOriginClearanceRejected:true,homeWithTestIssuedClearance:200,customerAndAdminLoginRoutesStayOnOrigin:true,signOutStaysOnOrigin:true,secureHostOnlyCookies:true,oauthStartCallback:provider.searchParams.get('redirect_to'),cancelPreservesSelection:true,forgedCallbackRejected:true,crossOriginMutationsRejected:true,authenticatedMutationRequiresAccount:true});
  }
  for(const path of ['/','/verify','/api/verification','/auth/callback?error=access_denied']) {
    assert.equal((await send(developmentOrigins[0],path,{headers:{Host:'evil.example'}})).status,403);
  }
  // Explicitly public assets are served without Host-based application
  // privileges, including Next's header-free internal image requests.
  for(const path of ['/spaces/hero.webp','/_next/image?url=%2Fspaces%2Fhero.webp&w=640&q=75']) {
    const asset=await send(developmentOrigins[0],path,{headers:{Host:'evil.example'}});
    assert.equal(asset.status,200);assert.equal(asset.headers['set-cookie'],undefined);
    assert.match(String(asset.headers['content-type']),/^image\//);
  }
  const spoofed:Record<string,string>[]=[{'X-Forwarded-Host':'evil.example'},{'X-Forwarded-Host':new URL(developmentOrigins[1]).host},{'X-Forwarded-Proto':'https'},{'X-Forwarded-Host':'localhost:3000, evil.example'}];
  for(const extra of spoofed) {
    assert.equal((await send(developmentOrigins[0],'/verify',{headers:extra})).status,403);
  }
  mkdirSync(evidence,{recursive:true});
  writeFileSync(evidence+'/local-http.json',JSON.stringify({at:new Date().toISOString(),kind:'controlled localhost transport with exact browser headers; test-issued signed clearance; genuine keys and real Siteverify invalid-token rejection; no genuine pass or owner acceptance',unknownAndSpoofedOriginsRejected:true,results},null,2));
  console.log('PASSED: both origin journeys, assets/video, real invalid-token Siteverify, OAuth start/cancel/saved selection, cookie flags and unknown/spoofed-origin rejection. Controlled local transport; no genuine browser pass claimed.');
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:'Development-origin checks failed; response bodies and cookies withheld.');process.exitCode=1;});
