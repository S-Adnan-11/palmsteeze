import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

// Test/tooling reports must never replace historical acceptance evidence.
export function writeEvidence(name:string,value:unknown) {
  if(!/^[a-z0-9-]+\.json$/.test(name))throw new Error('Invalid evidence filename');
  const base=resolve('docs/evidence');
  const root=resolve(process.env.PALMSTEEZE_EVIDENCE_ROOT||join(base,'current-checks'));
  if(!root.startsWith(base+sep))throw new Error('Evidence must stay in a private docs/evidence subdirectory');
  mkdirSync(root,{recursive:true});
  writeFileSync(join(root,`${Date.now()}-${randomUUID().slice(0,8)}-${name}`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
