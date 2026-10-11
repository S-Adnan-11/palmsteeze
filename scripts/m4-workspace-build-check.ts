import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {loadLocalEnvironment} from './lib/database';
import {createClearance} from '../src/lib/security-sessions';

async function main() {
  const root=resolve(process.argv[2]||'');
  assert.ok(existsSync(join(root,'run.json')),'Fresh evidence run required');
  loadLocalEnvironment();
  const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
  const response=await fetch('http://localhost:3000/',{headers:{Cookie:`ps-clearance=${createClearance(process.env)}`},cache:'no-store'});
  assert.equal(response.status,200);
  const html=await response.text();assert.ok(html.includes('data-story-panel'));
  const paths=[...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]))];
  const assets=[];let newControllerServed=false;let isolatedStylesServed=false;
  for(const path of paths) {
    const served=Buffer.from(await(await fetch('http://localhost:3000'+path,{cache:'no-store'})).arrayBuffer());
    assert.equal(hash(served),hash(readFileSync('.next/'+path.slice('/_next/'.length))));
    newControllerServed ||= served.includes(Buffer.from('data-story-panel'));
    isolatedStylesServed ||= served.includes(Buffer.from('--pin-inset'));
    assets.push({path,sha256:hash(served),matchesRebuiltFiles:true});
  }
  assert.ok(newControllerServed&&isolatedStylesServed);
  writeFileSync(join(root,'final-running-build.json'),JSON.stringify({at:new Date().toISOString(),url:'http://localhost:3000',buildId:readFileSync('.next/BUILD_ID','utf8').trim(),assets,newControllerServed,isolatedStylesServed,sourceFiles:['src/components/workspace-experience.tsx','src/components/workspace-experience.module.css','src/app/refinement.css'].map(path=>({path,sha256:hash(readFileSync(path))})),access:'Genuine-key production server; test-issued signed entrance clearance for this read only. No successful genuine challenge claimed.'},null,2),{flag:'wx'});
  console.log(`Verified ${assets.length} served homepage assets, including the rebuilt controller and isolated styles.`);
}
void main().catch(()=>{console.error('Running workspace build verification failed; private values withheld');process.exitCode=1;});
