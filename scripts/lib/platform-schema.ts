import type { Client } from 'pg';

// Supabase's documented opt-in automatic-RLS event trigger, preserved unchanged.
// https://supabase.com/docs/guides/database/postgres/event-triggers
const documentedBody = `
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public')
      AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
      AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
          RAISE;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
`;
// Ignore formatting/keyword case only outside string literals; preserve literal semantics.
const normalize = (sql:string) => sql.trim().split(/('(?:''|[^'])*')/g).map((part,index) => index % 2 ? part
  : part.replace(/\s+/g,' ').replace(/\s*([(),;])\s*/g,'$1').toLowerCase()).join('');

export async function verifiedPlatformRls(client:Client):Promise<number|null> {
  const result = await client.query(`select p.oid,p.prosrc,p.pronargs,p.prorettype='event_trigger'::regtype as event_result,
    p.prosecdef,p.proconfig,l.lanname,pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.proname='rls_auto_enable'`);
  if (!result.rowCount) return null;
  if (result.rowCount !== 1) return null;
  const f = result.rows[0];
  // Dashboard versions log an error without rethrowing; neither variant is modified.
  const bodies = [documentedBody,documentedBody.replace('          RAISE;','')].map(normalize);
  if (f.pronargs !== 0 || !f.event_result || !f.prosecdef || f.lanname !== 'plpgsql' || f.owner !== 'postgres'
      || JSON.stringify(f.proconfig) !== JSON.stringify(['search_path=pg_catalog']) || !bodies.includes(normalize(f.prosrc))) return null;
  const triggers = await client.query(`select evtname,evtevent,evtenabled,evttags,pg_get_userbyid(evtowner) as owner
    from pg_event_trigger where evtfoid=$1`,[f.oid]);
  if (triggers.rowCount !== 1) return null;
  const t = triggers.rows[0];
  if (t.evtname !== 'ensure_rls' || t.evtevent !== 'ddl_command_end' || t.evtenabled !== 'O' || t.owner !== 'postgres'
      || JSON.stringify([...t.evttags].sort()) !== JSON.stringify(['CREATE TABLE','CREATE TABLE AS','SELECT INTO'])) return null;
  console.log('PASSED: existing automatic-RLS routine body, signature, owner, search path and event trigger match the documented platform pattern; preserved unchanged.');
  return f.oid as number;
}
