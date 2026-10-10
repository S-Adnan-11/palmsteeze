import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('Current run required');
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const history=JSON.parse(readFileSync(join(root,'historical-hashes.json'),'utf8')) as {path:string;sha256:string}[];
const changed=history.filter(entry=>!existsSync(entry.path)||digest(entry.path)!==entry.sha256);
const original=resolve('.tools',root.split(/[\\/]/).at(-1)!,'before-source');
const boundaryFiles=['src/lib/domain.ts','src/lib/payments.ts','src/lib/reservation-capability.ts','src/lib/security-sessions.ts','src/lib/turnstile-verification.ts','src/lib/turnstile-config.ts','src/lib/turnstile.ts','src/lib/entrance.ts','src/proxy.ts','src/app/api/checkout/route.ts','src/app/api/holds/route.ts'];
function walk(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(directory,entry.name)):[join(directory,entry.name)]);}
boundaryFiles.push(...walk('src/app/api/bookings').map(path=>path.replaceAll('\\','/')));
const boundaries=boundaryFiles.map(path=>({path,unchangedSinceRun:digest(path)===digest(join(original,path))}));
const incident=JSON.parse(readFileSync('docs/evidence/m4-standardization/evidence-incident.json','utf8'));assert.equal(incident.unrecovered.length,21);
const currentSources=walk('src');const sourceChanges=currentSources.filter(path=>!existsSync(join(original,path))||digest(path)!==digest(join(original,path))).map(path=>relative('.',path).replaceAll('\\','/'));
writeFileSync(join(root,'preservation-audit.json'),JSON.stringify({at:new Date().toISOString(),historicalFilesChecked:history.length,historicalFilesChanged:changed,incidentRecordUnchanged:changed.every(entry=>entry.path!=='docs/evidence/m4-standardization/evidence-incident.json'),unrecoveredHistoricalItems:incident.unrecovered.length,newHistoricalRecoveries:0,boundaries,sourceChanges},null,2),{flag:'wx'});
assert.equal(changed.length,0);assert.ok(boundaries.every(entry=>entry.unchangedSinceRun));console.log(`Preserved ${history.length} historical files and ${boundaries.length} server/domain boundary files; 21 historical items remain unrecovered.`);
