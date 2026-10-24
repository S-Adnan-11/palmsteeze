import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {developmentOrigins} from '../supabase/functions/_shared/application-origins.ts';

// Reuse this workspace's existing tunnel. A hostname match is required before
// any update; neither port creation nor access-policy changes are permitted.
const tunnelId='joyful-pond-fhc87t8';
const clusterId='euw';
const qualifiedId=`${tunnelId}.${clusterId}`;
const origin=developmentOrigins[1];
const cli=resolve('.tools/devtunnel/devtunnel.exe');
type Metadata={tunnelId:string;clusterId:string;name?:string;protocol?:string;portForwardingUris?:string[];
  accessControl:unknown;options:Record<string,unknown>;status?:{hostConnectionCount?:number}};
function command(args:string[]) {
  try {return JSON.parse(execFileSync(cli,[...args,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
  catch {throw new Error('Dev Tunnels CLI access failed. If login has expired, run ./.tools/devtunnel/devtunnel.exe user login -g -d using the existing tunnel owner account.');}
}
function scopedToken(scope:'manage'|'connect') {
  const result=command(['token',qualifiedId,'--scope',scope]);
  if(typeof result.token!=='string'||!result.token) throw new Error('The existing tunnel did not issue the required scoped token.');
  return result.token as string;
}
async function metadata(token:string,port=false):Promise<Metadata> {
  const response=await fetch(`https://${clusterId}.rel.tunnels.api.visualstudio.com/tunnels/${tunnelId}${port?'/ports/3000':''}?api-version=2023-09-27-preview`,{
    headers:{Authorization:`tunnel ${token}`},signal:AbortSignal.timeout(15000),
  });
  if(!response.ok) throw new Error(`Existing tunnel inspection returned HTTP ${response.status}.`);
  return response.json();
}
async function liveCheck(token:string) {
  const send=(path:string,init:RequestInit={})=>fetch(origin+path,{...init,headers:{'X-Tunnel-Authorization':`tunnel ${token}`,...init.headers},redirect:'manual',signal:AbortSignal.timeout(20000)});
  const entrance=await send('/');
  assert.equal(entrance.status,307,'Tunnel entrance must redirect to verification.');
  const target=new URL(entrance.headers.get('location')||'',origin);
  assert.equal(target.origin,origin,'Entrance must retain the configured tunnel origin.');
  assert.equal(target.pathname,'/verify');
  assert.equal((await send('/verify')).status,200,'Verification must be reachable.');
  const post=(requestOrigin:string)=>send('/api/preferences',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:'{"optional":false}'});
  const preference=await post(origin);
  assert.equal(preference.status,200,'Origin must reach the application unchanged.');
  const cookie=preference.headers.getSetCookie().find(value=>value.startsWith('ps-preferences='))||'';
  assert.ok(/;\s*secure/i.test(cookie)&&/;\s*httponly/i.test(cookie)&&!/;\s*domain=/i.test(cookie),'Application cookies must stay secure and host-only.');
  assert.equal((await post('https://untrusted.example')).status,403,'Foreign origins must remain rejected.');
  const anonymous=await fetch(origin+'/verify',{redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.equal(anonymous.status,302,'Tunnel authentication must remain required.');
  assert.ok((anonymous.headers.get('location')||'').startsWith('https://global.rel.tunnels.api.visualstudio.com/auth/'));
}
async function main() {
  const checkOnly=process.argv[2]==='--check';
  if(!checkOnly&&process.argv[2]!=='--repair') throw new Error('Use --repair or --check.');
  const token=scopedToken('manage');
  const beforeTunnel=await metadata(token),beforePort=await metadata(token,true);
  assert.equal(beforeTunnel.tunnelId,tunnelId);assert.equal(beforePort.tunnelId,tunnelId);
  assert.equal(beforeTunnel.clusterId,clusterId);assert.equal(beforePort.clusterId,clusterId);
  assert.ok(beforePort.portForwardingUris?.includes(origin+'/'),'Existing port must match the exact configured tunnel hostname.');
  if(!checkOnly) {
    // VS Code can recreate the port with no preservation flags. Set the tunnel
    // defaults as well, so that exact observed reset pattern inherits safely.
    command(['update',qualifiedId,'--host-header','unchanged','--origin-header','unchanged']);
    command(['port','update',qualifiedId,'-p','3000','--host-header','unchanged','--origin-header','unchanged']);
  }
  const afterTunnel=await metadata(token),afterPort=await metadata(token,true);
  assert.equal(afterTunnel.tunnelId,beforeTunnel.tunnelId);assert.equal(afterTunnel.name,beforeTunnel.name);
  assert.equal(afterPort.protocol,beforePort.protocol);
  if(!isDeepStrictEqual(afterTunnel.accessControl,beforeTunnel.accessControl)
    ||!isDeepStrictEqual(afterPort.accessControl,beforePort.accessControl)) throw new Error('Tunnel access policy changed unexpectedly.');
  assert.deepEqual(afterPort.portForwardingUris,beforePort.portForwardingUris);
  for(const [before,after] of [[beforeTunnel,afterTunnel],[beforePort,afterPort]]) {
    assert.deepEqual(after.options,{...before.options,isHostHeaderUnchanged:true,isOriginHeaderUnchanged:true},'Both tunnel defaults and port overrides must preserve Host and Origin. Run ./scripts/tunnel.ps1 to restore them.');
  }
  const hostConnected=(afterTunnel.status?.hostConnectionCount||0)>0;
  if(hostConnected) await liveCheck(scopedToken('connect'));
  console.log(JSON.stringify({origin,tunnelId:qualifiedId,hostConnected,hostAndOriginPreserved:true,hostnameAndPoliciesUnchanged:true,authenticatedHTTPSChecked:hostConnected}));
}
main().catch(error=>{
  // Child-process errors may contain token responses; never print those objects.
  console.error(error instanceof assert.AssertionError?'Tunnel validation failed. Check the development server and run ./scripts/tunnel.ps1 to restore forwarding.':error instanceof Error?error.message:'Tunnel preparation failed.');
  process.exitCode=1;
});
