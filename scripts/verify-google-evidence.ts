import { verifyProject,connectDatabase,safeFailure,ReadinessError } from './lib/database';

// Read-only corroboration of an owner's manual Google test. Does not inspect sessions,
// tokens, emails or provider metadata, and cannot independently prove browser behavior.
async function main() {
  await verifyProject();
  const client = await connectDatabase();
  try {
    await client.query('begin read only');
    const {rows} = await client.query(`
      select
        exists(select 1 from auth.identities where provider='google') as google_identity_present,
        exists(select 1 from public.bookings b
          where exists(select 1 from auth.identities i where i.user_id=b.owner_id and i.provider='google'))
          as google_owned_booking_present,
        exists(select 1 from public.bookings b join public.allocations a on a.booking_id=b.id
          where a.resource_id=b.resource_id
            and a.period=tstzrange(b.starts_at,b.ends_at,'[)')
            and b.total_kobo=b.deposit_kobo+b.balance_kobo
            and b.total_kobo>0
            and not exists(select 1 from private.app_roles r where r.user_id=b.owner_id)
            and exists(select 1 from auth.identities i where i.user_id=b.owner_id and i.provider='google'))
          as ordinary_google_customer_allocation_and_snapshot_present
    `);
    await client.query('commit');
    if (!Object.values(rows[0]).every((value) => value === true)) {
      throw new ReadinessError('NOT RUN: stored Google/customer booking corroboration is incomplete; identities and records withheld.');
    }
    console.log('PASSED: read-only, certificate-verified PostgreSQL corroborates a Google identity, its stored booking and an ordinary Google customer allocation with consistent price snapshot. No identity, token or booking details logged.');
    console.log('LIMIT: aggregate owner-level corroboration is not RLS or interactive browser proof; use the separate actual-role tests and an interactive Google check for those checks. No data changed.');
  } finally {await client.end();}
}
main().catch(safeFailure);
