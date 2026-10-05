import { mkdirSync,writeFileSync } from 'node:fs';
import { verifyProject,connectDatabase,inspectDatabase,safeFailure } from './lib/database';

async function main() {
  await verifyProject();
  const client = await connectDatabase();
  const report:Record<string,unknown> = {};
  try {
    await inspectDatabase(client);
    await client.query('begin read only');
    report.legacyBookings = (await client.query(`select count(*)::int as total,
      count(*) filter(where state='held')::int as held,
      count(*) filter(where state='held' and expires_at<=now())::int as elapsed_unpaid,
      count(*) filter(where state='released')::int as released,
      count(*) filter(where state='expired')::int as expired from public.bookings`)).rows[0];
    report.recoveryExtensions = (await client.query(`select name,installed_version,default_version
      from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault') order by name`)).rows;
    report.recoverySchemas = (await client.query(`select to_regnamespace('cron') is not null as cron,
      to_regnamespace('net') is not null as net,to_regnamespace('vault') is not null as vault`)).rows[0];
    await client.query('commit');
  } finally {await client.end();}
  report.configuration = ['STRIPE_SECRET_KEY','STRIPE_ACCOUNT_ID','STRIPE_WEBHOOK_SECRET','STRIPE_SANDBOX_EMAIL'].map(name=>({name,present:Boolean(process.env[name])}));
  report.stripeSandboxConfirmed = process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED === 'true';
  report.management = await Promise.all(['functions','secrets'].map(async operation=>{
    const response = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/${operation}`,{
      headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(15000)});
    if (!response.ok) return {operation,status:response.status};
    const data = await response.json();
    return {operation,status:response.status,count:Array.isArray(data) ? data.length : null};
  }));
  report.packages = await Promise.all(['stripe','@stripe/cli'].map(async name=>{
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,{signal:AbortSignal.timeout(15000)});
    const p = await response.json();return {name,version:p.version,engines:p.engines,bin:p.bin,repository:p.repository};
  }));
  mkdirSync('docs/evidence',{recursive:true});
  writeFileSync('docs/evidence/m2b-inspection.json',JSON.stringify({checkedAt:new Date().toISOString(),...report},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  console.log('PASSED: read-only selected-project inspection complete; no account identities, credentials or connection strings logged; no bookings changed.');
}
main().catch(safeFailure);
