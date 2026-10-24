import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';

// Run before any captures. Every invocation reserves a new directory; no reuse.
const run=`m4-targeted-${new Date().toISOString().replace(/[-:.]/g,'')}-${randomUUID().slice(0,8)}`;
const root=join('docs/evidence',run);
mkdirSync(root); // Deliberately no recursive/exist-ok on the run directory.
const history:{path:string;sha256:string}[]=[];
function inventory(directory:string) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(resolve(path)===resolve(root))continue;
    if(entry.isDirectory())inventory(path);
    else history.push({path:path.replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
  }
}
inventory('docs');
for(const file of readdirSync('.').filter(name=>/^(M[345]_.*\.(md|html)|AGENTS\.md|READINESS\.md|TEST_REPORT\.md|PalmSteeze_Project_Plan\.md|SECURITY_BOUNDARY\.md|TURNSTILE\.md)$/.test(name))) {
  history.push({path:file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
}
writeFileSync(join(root,'historical-hashes.json'),JSON.stringify(history,null,2),{flag:'wx'});
const snapshot=join('.tools',run,'before-source');mkdirSync(snapshot,{recursive:true});
function preserve(path:string) {
  if(!existsSync(path))return;
  for(const entry of readdirSync(path,{withFileTypes:true})) {
    const from=join(path,entry.name);
    if(entry.isDirectory())preserve(from);
    else {const to=join(snapshot,relative('.',from));mkdirSync(join(to,'..'),{recursive:true});copyFileSync(from,to);}
  }
}
for(const directory of ['src','tests','scripts'])preserve(directory);
for(const file of readdirSync('.').filter(name=>/\.(ts|json|md|html)$/.test(name)))copyFileSync(file,join(snapshot,file));
writeFileSync(join(root,'run.json'),JSON.stringify({run,startedAt:new Date().toISOString(),unrecoveredHistoricalItems:21,ownerObservation:'Owner reports successful entrance verification; separate from automated provider outcomes.',milestones:{M4:'open',M3:'closed under revised permanent-provider-rejection criterion',M5:'paused'}},null,2),{flag:'wx'});
console.log(root.replaceAll('\\','/'));
