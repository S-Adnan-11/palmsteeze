import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const run=`m4-stabilization-${new Date().toISOString().replace(/[-:.]/g,'')}-${randomUUID().slice(0,8)}`;
const root=join('docs/evidence',run);
mkdirSync(root);
const history:{path:string;sha256:string}[]=[];
function inventory(directory:string) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(resolve(path)===resolve(root))continue;
    if(entry.isDirectory())inventory(path);
    else history.push({path:path.replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
  }
}
inventory('docs');inventory('reviews');
for(const path of ['AGENTS.md','PalmSteeze_Project_Plan.md','READINESS.md','TEST_REPORT.md']) {
  history.push({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
}
writeFileSync(join(root,'historical-hashes.json'),JSON.stringify(history,null,2),{flag:'wx'});
const snapshot=join('.tools',run,'before-source');
function preserve(directory:string) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())preserve(path);
    else {const to=join(snapshot,path);mkdirSync(join(to,'..'),{recursive:true});copyFileSync(path,to);}
  }
}
for(const directory of ['src','tests','scripts'])preserve(directory);
writeFileSync(join(root,'run.json'),JSON.stringify({run,startedAt:new Date().toISOString(),ownerFeedback:{popupCollision:'owner-observed fixed',visualDirection:'accepted',workspaceMotion:'NOT visually accepted',google:'outstanding',physicalPhone:'outstanding',genuineReservationTurnstile:'outstanding'},unrecoveredHistoricalItems:21,M3:'closed under revised permanent-provider-rejection criterion',M4:'bounded stabilization and acceptance; open',M5:'publication paused'},null,2),{flag:'wx'});
console.log(root.replaceAll('\\','/'));
