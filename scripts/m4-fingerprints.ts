import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {connectDatabase,inspectDatabase} from './lib/database';

async function main() {
  const root=resolve(process.argv[2]||'');const mode=process.argv[3];
  if(!existsSync(join(root,'run.json'))||!['before','after'].includes(mode))throw new Error('New run root and before/after required');
  const privateRoot=resolve('.tools',root.split(/[\\/]/).at(-1)!);mkdirSync(privateRoot,{recursive:true});
  const privateFile=join(privateRoot,'original-rows.json');
  const original=mode==='after'?JSON.parse(readFileSync(privateFile,'utf8')) as Record<string,string[]>:null;
  const db=await connectDatabase();
  try {
    await inspectDatabase(db);
    const rows:Record<string,string[]>={};const tables=[];
    for(const table of ['public.bookings','public.allocations','public.payment_attempts','public.cancellation_requests','public.admin_audit','public.refund_operations','public.payment_refund_receipts','private.cancellation_identity','private.payment_events']) {
      const result=await db.query(`select to_jsonb(t)::text value from ${table} t order by to_jsonb(t)::text`);
      rows[table]=result.rows.map(row=>row.value);
      const prior=original?.[table];
      const unchanged=prior?.every(value=>rows[table].includes(value));
      tables.push({table,count:rows[table].length,originalCount:prior?.length,originalPreserved:unchanged,hash:createHash('sha256').update((prior||rows[table]).join('\n')).digest('hex')});
    }
    if(mode==='before')writeFileSync(privateFile,JSON.stringify(rows),{flag:'wx'});
    const output=join(root,`database-${mode}.json`);
    writeFileSync(output,JSON.stringify({at:new Date().toISOString(),tls:'certificate verified',tables},null,2),{flag:'wx'});
    if(tables.some(table=>table.originalPreserved===false))throw new Error('Original records changed. Inspect privately.');
    console.log(`Recorded ${tables.length} table fingerprints; original preservation ${mode==='before'?'baseline':'passed'}.`);
  } finally {await db.end();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Fingerprint failed');process.exitCode=1;});
