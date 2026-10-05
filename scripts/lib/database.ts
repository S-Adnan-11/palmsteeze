import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { verifiedPlatformRls } from './platform-schema';

export class ReadinessError extends Error {}

export function loadLocalEnvironment() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
}

export function databaseConfiguration() {
  loadLocalEnvironment();
  const required = ['SUPABASE_PROJECT_REF','DATABASE_HOST','DATABASE_USER','DATABASE_PASSWORD'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new ReadinessError(`NOT RUN: missing private configuration (${missing.join(', ')}).`);
  const ref = process.env.SUPABASE_PROJECT_REF!;
  if (!/^[a-z0-9]{20}$/.test(ref)
      || !/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(process.env.DATABASE_HOST!)
      || process.env.DATABASE_USER !== `postgres.${ref}`
      || (process.env.DATABASE_PORT || '5432') !== '5432'
      || (process.env.DATABASE_NAME || 'postgres') !== 'postgres') {
    throw new ReadinessError('NOT RUN: target must be the matching Supabase shared session pooler on 5432.');
  }
  if (process.env.PALMSTEEZE_DB_DEDICATED !== 'true' || process.env.PALMSTEEZE_DB_FREE_CONFIRMED !== 'true') {
    throw new ReadinessError('NOT RUN: owner must confirm the dedicated Free development target in local configuration.');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url !== `https://${ref}.supabase.co`) throw new ReadinessError('NOT RUN: API project and database reference must match.');
  return {
    host: process.env.DATABASE_HOST!, port: 5432,
    user: process.env.DATABASE_USER!, password: process.env.DATABASE_PASSWORD!, database: 'postgres',
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_CA_FILE ? { ca: readFileSync(resolve(process.env.DATABASE_CA_FILE),'utf8') } : {}),
    },
    connectionTimeoutMillis: 15000,
    application_name: 'palmsteeze-m1-proof',
  };
}

export async function verifyProject() {
  databaseConfiguration();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new ReadinessError('NOT RUN: fill SUPABASE_ACCESS_TOKEN privately in .env.local to verify project identity before database changes.');
  const response = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ReadinessError(`NOT RUN: project verification returned HTTP ${response.status}; response withheld.`);
  const project = await response.json();
  if (project.id !== process.env.SUPABASE_PROJECT_REF || project.name !== 'palmsteeze-dev' || project.status !== 'ACTIVE_HEALTHY') {
    throw new ReadinessError('NOT RUN: selected project is not the expected healthy palmsteeze-dev project.');
  }
  console.log('PASSED: Management API verified dedicated project name/reference/status. Free tier confirmed by owner flag; billing not independently queried.');
}

export async function connectDatabase() {
  const client = new Client(databaseConfiguration());
  await client.connect();
  const stream = (client as unknown as { connection: { stream: { encrypted?: boolean; authorized?: boolean } } }).connection.stream;
  if (!stream.encrypted || !stream.authorized) {
    await client.end();
    throw new ReadinessError('FAILED: encrypted, certificate-verified database transport required.');
  }
  await client.query("set statement_timeout = '20s'");
  await client.query("set lock_timeout = '10s'");
  return client;
}

const permittedTables = new Set(['venue_settings','resources','resource_rates','bookings','allocations','payment_attempts','cancellation_requests','admin_audit','refund_operations','payment_refund_receipts']);

export async function inspectDatabase(client: Client) {
  await client.query('begin read only');
  try {
    const info = await client.query(`select current_setting('server_version') as version,
      current_user as database_role, has_schema_privilege(current_user,'public','CREATE') as can_create,
      exists(select 1 from pg_roles where rolname = 'authenticated') as authenticated_role,
      exists(select 1 from pg_roles where rolname = 'anon') as anonymous_role,
      to_regclass('auth.users') is not null as auth_users`);
    const extensions = await client.query(`select a.name,a.installed_version,a.default_version,n.nspname as installed_schema
      from pg_available_extensions a left join pg_extension e on e.extname=a.name
      left join pg_namespace n on n.oid=e.extnamespace
      where a.name in ('btree_gist','pg_cron','pg_net') order by a.name`);
    const tables = await client.query(`select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
    const privateTables = await client.query(`select table_name from information_schema.tables
      where table_schema = 'private' and table_type = 'BASE TABLE' order by table_name`);
    const unknown = tables.rows.some((t) => !permittedTables.has(t.table_name))
      || privateTables.rows.some((t) => !['app_roles','schema_migrations','recovery_probe_runs','recovery_probe_jobs','payment_jobs','payment_events','cancellation_identity'].includes(t.table_name));
    if (unknown) throw new ReadinessError('NOT RUN: unrecognized tables exist in the selected target; migrations refused pending review. Names/data withheld.');
    const hasHistory = privateTables.rows.some((t) => t.table_name === 'schema_migrations');
    if ((tables.rowCount || privateTables.rowCount) && !hasHistory) {
      throw new ReadinessError('NOT RUN: target contains tables without PalmSteeze migration history; automatic adoption refused.');
    }
    if (!info.rows[0].can_create || !info.rows[0].auth_users || !info.rows[0].authenticated_role || !info.rows[0].anonymous_role
        || !extensions.rows.some((e) => e.name === 'btree_gist')) {
      throw new ReadinessError('NOT RUN: required schema permissions, Supabase Auth roles, or btree_gist availability missing.');
    }
    const gist = extensions.rows.find((e) => e.name === 'btree_gist');
    if (gist.installed_version && gist.installed_schema !== 'extensions') {
      throw new ReadinessError('NOT RUN: btree_gist is installed outside the expected extensions schema; review required without moving unrelated objects.');
    }
    // Refuse nonempty unrelated functions/types even when public tables are absent.
    const platformRls = await verifiedPlatformRls(client);
    const objects = await client.query(`select
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and ($1::oid is null or p.oid <> $1::oid) and not exists(select 1 from pg_depend d
         where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')) as routines,
      (select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace
       where n.nspname='public' and t.typtype='e') as enums`,[platformRls]);
    console.log(JSON.stringify({check:'database inspection metadata',tls:'certificate verified',...info.rows[0],extensions:extensions.rows,existingApplicationTables:tables.rowCount}));
    if (!hasHistory && (Number(objects.rows[0].routines) > 0 || Number(objects.rows[0].enums) > 0)) {
      const routines = await client.query(`select p.proname as name,l.lanname as language,
        pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where n.nspname='public' and not exists(select 1 from pg_depend d
          where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by p.proname`);
      const enums = await client.query(`select t.typname as name from pg_type t join pg_namespace n on n.oid=t.typnamespace
        where n.nspname='public' and t.typtype='e' order by t.typname`);
      console.log(JSON.stringify({check:'preexisting schema objects',routines:routines.rows,enums:enums.rows,definitionsAndData:'withheld'}));
      throw new ReadinessError('NOT RUN: target contains existing public routines/types; automatic migration refused.');
    }
    console.log(JSON.stringify({check:'database inspection',status:'PASSED',tls:'certificate verified',...info.rows[0],extensions:extensions.rows,existingApplicationTables:tables.rowCount}));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export function safeFailure(error: unknown) {
  if (error instanceof ReadinessError) console.error(error.message);
  else {
    const code = (error as { code?: unknown })?.code;
    console.error(`FAILED: operation stopped (${typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'DETAILS_WITHHELD'}). No connection strings or provider details logged.`);
  }
  process.exitCode = 1;
}
