import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import Stripe from 'stripe';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connectDatabase} from './lib/database';

async function main(){
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('Current evidence run required');
  const started=JSON.parse(readFileSync(join(root,'run.json'),'utf8')).startedAt,cutoff=process.argv[3];
  assert.ok(Date.parse(cutoff)>Date.parse(started)&&Date.parse(cutoff)<Date.now());
  const db=await connectDatabase();
  try{
    const key=process.env.STRIPE_SECRET_KEY||'';assert.match(key,/^(sk_test_|rk_test_|rkcs_test_)/);assert.equal(process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED,'true');
    const stripe=new Stripe(key,{maxNetworkRetries:1,timeout:15000});assert.equal((await stripe.accounts.retrieveCurrent()).id,process.env.STRIPE_ACCOUNT_ID);
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const users=await db.query("select id from auth.users where (email like 'm4-targeted-%@palmsteeze.invalid' or email like 'm4-recording-%@palmsteeze.invalid') and created_at >= $1 and created_at < $2",[started,cutoff]);const results=[];
    for(const {id} of users.rows){
      const payments=await db.query('select * from public.payment_attempts where owner_id=$1',[id]);
      if(payments.rows.some(row=>Number(row.collected_kobo)>0)){results.push({userId:id,retained:'New paid sandbox evidence'});continue;}
      let uncertain=false;
      for(const payment of payments.rows){
        if(payment.session_id){const session=await stripe.checkout.sessions.retrieve(payment.session_id);assert.equal(session.livemode,false);if(session.payment_status==='paid'){uncertain=true;break;}if(session.status==='open')await stripe.checkout.sessions.expire(session.id);const expired=await stripe.checkout.sessions.retrieve(session.id);assert.equal(expired.status,'expired');assert.equal(expired.payment_status,'unpaid');}
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/palmsteeze-payments/recover`,{method:'POST',headers:{Authorization:`Bearer ${process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:payment.booking_id}),signal:AbortSignal.timeout(40000)});
      }
      if(uncertain){results.push({userId:id,retained:'Provider paid or uncertain; no deletion'});continue;}
      const safe=await db.query("select count(*)::int n from public.payment_attempts where owner_id=$1 and (collected_kobo<>0 or state not in ('expired','creation_failed'))",[id]);
      if(safe.rows[0].n){results.push({userId:id,retained:'Not yet terminal; no deletion'});continue;}
      const historical=await db.query('select count(*)::int n from public.bookings where owner_id=$1 and created_at<$2',[id,started]);assert.equal(historical.rows[0].n,0);
      await db.query('begin');try{
        await db.query('delete from private.payment_events where attempt_id in (select id from public.payment_attempts where owner_id=$1)',[id]);await db.query('delete from private.payment_jobs where attempt_id in (select id from public.payment_attempts where owner_id=$1)',[id]);
        await db.query('delete from public.payment_attempts where owner_id=$1',[id]);await db.query('delete from public.allocations where booking_id in (select id from public.bookings where owner_id=$1)',[id]);await db.query('delete from public.bookings where owner_id=$1',[id]);await db.query('commit');
      }catch(error){await db.query('rollback');throw error;}
      assert.equal((await admin.auth.admin.deleteUser(id)).error,null);results.push({userId:id,removed:true,providerUnpaidExpiredVerified:true,createdAfterRunStart:true});
    }
    writeFileSync(join(root,'fixture-cleanup-'+Date.now()+'-'+randomUUID().slice(0,8)+'.json'),JSON.stringify({at:new Date().toISOString(),started,cutoff,results},null,2),{flag:'wx'});console.log('Scoped fixture cleanup recorded; paid evidence retained.');
  }finally{await db.end();}
}
void main().catch(()=>{console.error('Scoped fixture cleanup failed; uncertain records retained');process.exitCode=1;});
