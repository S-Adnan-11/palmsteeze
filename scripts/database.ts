import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { connectDatabase, inspectDatabase, verifyProject, safeFailure, ReadinessError } from './lib/database';
import {securityKey} from '../src/lib/security-sessions';
import {configuredAppOrigin} from '../src/lib/deployment';

async function run() {
  const command = process.argv[2];
  if (!['inspect','migrate','seed'].includes(command)) throw new ReadinessError('Use inspect, migrate, or seed.');
  await verifyProject();
  const client = await connectDatabase();
  try {
    await inspectDatabase(client);
    if (command === 'inspect') return;
    await client.query('begin');
    try {
      await client.query("select pg_advisory_xact_lock(hashtextextended('palmsteeze:migrations',0))");
      if (command === 'migrate') {
        await client.query(`create schema if not exists private;
          revoke all on schema private from public,anon,authenticated;
          create table if not exists private.schema_migrations(version text primary key,sha256 text not null,applied_at timestamptz not null default now());
          revoke all on private.schema_migrations from public,anon,authenticated;`);
        const files = readdirSync('supabase/migrations').filter((name) => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
        for (const file of files) {
          const sql = readFileSync(`supabase/migrations/${file}`,'utf8');
          const hash = createHash('sha256').update(sql).digest('hex');
          const previous = await client.query('select sha256 from private.schema_migrations where version=$1',[file]);
          if (previous.rowCount) {
            if (previous.rows[0].sha256 !== hash) throw new ReadinessError('FAILED: previously applied migration checksum differs; do not rewrite applied migrations.');
            console.log(`PASSED: ${file} already applied; checksum matches.`);
          } else {
            await client.query(sql);
            await client.query('insert into private.schema_migrations(version,sha256) values($1,$2)',[file,hash]);
            console.log(`Applied ${file}; transaction not yet committed.`);
          }
        }
        if((await client.query("select to_regclass('private.reservation_security_config') is not null ready")).rows[0].ready) {
          const key=securityKey(process.env);const origin=configuredAppOrigin(process.env);
          const existing=await client.query('select signing_key=$1 and app_origin=$2 matches from private.reservation_security_config where singleton',[key,origin]);
          if(existing.rowCount&&!existing.rows[0].matches) throw new ReadinessError('Reservation signing configuration mismatch; rotate through the reviewed procedure. Values withheld.');
          if(!existing.rowCount) await client.query('insert into private.reservation_security_config(signing_key,app_origin) values($1,$2)',[key,origin]);
          console.log('PASSED: private reservation signing configuration matches; values withheld.');
        }
      } else {
        const ready = await client.query("select to_regclass('private.schema_migrations') is not null as ready");
        if (!ready.rows[0].ready) throw new ReadinessError('NOT RUN: apply versioned migrations before seed.');
        await client.query(readFileSync('supabase/seed.sql','utf8'));
        const inventory = await client.query('select count(*)::int as resources,sum(seats)::int as seats from public.resources');
        console.log(JSON.stringify({check:'repeatable seed',...inventory.rows[0]}));
      }
      await client.query('commit');
      console.log(`PASSED: ${command} transaction committed.`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally { await client.end(); }
}
run().catch(safeFailure);
