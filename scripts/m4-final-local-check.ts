import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {loadLocalEnvironment} from './lib/database';
import {turnstileConfiguration,isTurnstileTestKey} from '../src/lib/turnstile-config';
async function main(){
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('Current run required');loadLocalEnvironment();
  const config=turnstileConfiguration(process.env);assert.equal(config.testing,false);assert.equal(isTurnstileTestKey(config.siteKey),false);assert.equal(isTurnstileTestKey(config.secret),false);
  function files(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);}
  const bundles=files('.next/static');const officialKeys=['1x00000000000000000000AA','3x00000000000000000000FF'];assert.ok(bundles.every(file=>officialKeys.every(key=>!readFileSync(file,'utf8').includes(key))));
  const entrance=await fetch('http://localhost:3000/api/verification');assert.equal(entrance.status,200);assert.equal((await entrance.json()).verified,false);
  const invalid=await fetch('http://localhost:3000/api/verification',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({token:'deliberately-invalid-m4-diagnostic',next:'/'})});assert.equal(invalid.status,403);
  writeFileSync(join(root,'final-local-environment-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),canonicalOrigin:'http://localhost:3000',genuineKeysConfigured:true,testMode:false,bundlesChecked:bundles.length,officialTestKeysAbsentFromFinalBuild:true,unclearedReadStatus:entrance.status,invalidProviderTokenStatus:invalid.status,noClearanceCookieFromInvalidToken:!invalid.headers.has('set-cookie'),kind:'Negative provider/network/configuration diagnostic; not a genuine successful challenge'},null,2),{flag:'wx'});
  assert.equal(invalid.headers.has('set-cookie'),false);console.log('Final genuine-key build and server verified; invalid token denied without clearance.');
}
void main().catch(()=>{console.error('Final local configuration diagnostic failed; values withheld');process.exitCode=1;});
