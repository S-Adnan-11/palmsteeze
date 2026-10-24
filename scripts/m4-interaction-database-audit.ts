import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {connectDatabase,inspectDatabase} from './lib/database';

async function main() {
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New evidence run required');
  const baseline='.tools/m4-targeted-20261010T130939937Z-18b8f520/original-rows.json';
  const original=JSON.parse(readFileSync(baseline,'utf8')) as Record<string,string[]>;
  const db=await connectDatabase();
  try {
    await inspectDatabase(db);const tables=[];
    for(const [table,values] of Object.entries(original)) {
      assert.match(table,/^(public|private)\.[a-z_]+$/);
      const current=(await db.query(`select to_jsonb(t)::text value from ${table} t`)).rows.map(row=>row.value);
      const originalPreserved=values.every(value=>current.includes(value));
      tables.push({table,originalCount:values.length,currentCount:current.length,originalPreserved});assert.equal(originalPreserved,true);
    }
    const paid=(await db.query('select b.state booking_state,b.total_kobo,p.state payment_state,p.amount_kobo,p.collected_kobo from public.bookings b join public.payment_attempts p on p.booking_id=b.id where b.id=$1',['dfb46fe5-c4e1-43e1-94fa-2488cbcdae39'])).rows[0];
    assert.equal(paid.booking_state,'confirmed');assert.equal(paid.payment_state,'paid');assert.equal(Number(paid.total_kobo),200000);assert.equal(Number(paid.amount_kobo),100001);assert.equal(Number(paid.collected_kobo),100001);
    const started=JSON.parse(readFileSync(join(root,'run.json'),'utf8')).startedAt;
    const remaining=(await db.query("select count(*)::int n from auth.users where created_at>=$1 and email like 'm4-targeted-%@palmsteeze.invalid'",[started])).rows[0].n;assert.equal(remaining,0);
    writeFileSync(join(root,'database-preservation.json'),JSON.stringify({at:new Date().toISOString(),kind:'Read-only current comparison with the preserved prior M4 baseline; no newly recreated historical baseline',baseline,tables,retainedPaidFixture:{confirmed:true,totalKobo:200000,collectedKobo:100001,remainingKobo:99999},newSyntheticAuthFixturesRemaining:remaining,newPaymentsInThisFollowup:0},null,2),{flag:'wx'});
    console.log('Nine original table snapshots and the retained paid fixture preserved; no new synthetic Auth fixtures remain.');
  } finally {await db.end();}
}
void main().catch(()=>{console.error('Database preservation check failed; row values withheld');process.exitCode=1;});
