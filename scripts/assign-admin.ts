import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure,ReadinessError } from './lib/database';
async function main() {
 await verifyProject();const db=await connectDatabase();
 try {
  await inspectDatabase(db);
  const email=process.env.PALMSTEEZE_OWNER_ADMIN_EMAIL;const id=process.env.PALMSTEEZE_OWNER_ADMIN_USER_ID;
  if(Boolean(email)===Boolean(id)) throw new ReadinessError('NOT RUN: privately set exactly one intended admin identifier, PALMSTEEZE_OWNER_ADMIN_EMAIL or PALMSTEEZE_OWNER_ADMIN_USER_ID.');
  const users=await db.query(`select u.id,u.email_confirmed_at is not null as confirmed,
   exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google' and i.identity_data->>'email_verified'='true'
    and ($1::text is null or lower(i.identity_data->>'email')=lower($1))) as verified_google
   from auth.users u where ($1::text is not null and lower(u.email)=lower($1)) or ($2::text is not null and u.id::text=$2)`,[email||null,id||null]);
  if(users.rowCount!==1 || !users.rows[0].confirmed || !users.rows[0].verified_google) throw new ReadinessError('NOT RUN: intended account must uniquely match a verified Google Auth identity; no role changed.');
  await db.query('begin');const result=await db.query("insert into private.app_roles(user_id,role) values($1,'admin') on conflict(user_id) do nothing returning user_id",[users.rows[0].id]);
  if(result.rowCount) await db.query("insert into public.admin_audit(action,target_id,reason,changes) values('owner_admin_assigned',$1,'Explicit owner instruction; verified Google account',jsonb_build_object('verified_provider','google'))",[users.rows[0].id]);
  assert.equal((await db.query('select role from private.app_roles where user_id=$1',[users.rows[0].id])).rows[0].role,'admin');await db.query('commit');
  mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/m3-owner-assignment.json',JSON.stringify({checkedAt:new Date().toISOString(),explicitSelectedVerifiedGoogleAccount:'PASSED',assignedRole:'admin',auditRecorded:true,identityDetails:'withheld'},null,2)+'\n');
  console.log('PASSED: explicitly selected verified Google account assigned administrator; audit recorded. No account identifier or credential printed.');
 } catch(error) {await db.query('rollback');throw error;} finally {await db.end();}
}
main().catch(safeFailure);
