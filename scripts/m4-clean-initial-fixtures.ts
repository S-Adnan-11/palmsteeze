import {createClient} from '@supabase/supabase-js';
import {writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {connectDatabase} from './lib/database';
async function main(){
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('Evidence run required');
  const db=await connectDatabase();
  try{
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const users=await db.query("select id from auth.users where email like 'm4-targeted-%@palmsteeze.invalid' and created_at >= '2026-10-10T13:24:00Z' and created_at < '2026-10-10T13:27:00Z'");
    for(const {id} of users.rows){
      const bookings=await db.query('select count(*)::int n from public.bookings where owner_id=$1',[id]);if(bookings.rows[0].n!==0)throw new Error('Business rows found; cleanup refused');
      await db.query("delete from auth.identities where user_id=$1 and provider='google' and created_at is null",[id]);
      const removed=await admin.auth.admin.deleteUser(id);if(removed.error)throw new Error('Synthetic Auth deletion failed; details withheld');
    }
    writeFileSync(join(root,'initial-fixture-cleanup.json'),JSON.stringify({at:new Date().toISOString(),createdInInitialFailedHarness:users.rowCount,zeroBusinessRows:true,removed:true,reason:'Controlled Google identity fixtures omitted timestamp columns; removed only this run’s empty synthetic accounts.'},null,2),{flag:'wx'});
    console.log('Removed initial run-owned empty synthetic fixtures: '+users.rowCount);
  }finally{await db.end();}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
