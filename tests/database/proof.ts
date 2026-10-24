import {fixtureReservationQuery} from './reservation-fixtures';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { Client } from 'pg';
import { connectDatabase,inspectDatabase,verifyProject,safeFailure,ReadinessError } from '../../scripts/lib/database';
import { initialBookingDate,intervalFromSelection } from '../../src/lib/domain';

type Identity = {id:string;token:string};
type Booking = {id:string;owner_id:string;state:string;total_kobo:number;hourly_kobo:number;deposit_percent:number;deposit_kobo:number;balance_kobo:number;currency:string;policy_snapshot:{deposit_percent:number}};
type Run = {client:Client;user:Identity|null};
async function asRole<T>(run: Run,fn:(client:Client) => Promise<T>,rollback = false): Promise<T> {
  await run.client.query('begin');
  try {
    await run.client.query(run.user ? 'set local role authenticated' : 'set local role anon');
    await run.client.query("select set_config('request.jwt.claims',$1,true)",[
      JSON.stringify(run.user ? {sub:run.user.id,role:'authenticated'} : {role:'anon'}),
    ]);
    const actual = await run.client.query('select current_user as role');
    assert.equal(actual.rows[0].role,run.user ? 'authenticated' : 'anon');
    const result = await fn(run.client);
    await run.client.query(rollback ? 'rollback' : 'commit');
    return result;
  } catch(error) { await run.client.query('rollback');throw error; }
}
const hold = (run:Run,resource:string,start:string,end:string,request=randomUUID(),race?: {ready:() => Promise<void>}) => asRole(run,async (c) => {
  if (race) await race.ready();
  const r = await fixtureReservationQuery(c,'select public.create_hold($1,$2,$3,$4) as booking',[resource,start,end,request]);
  if (race) await c.query('select pg_sleep(0.3)'); // keep the winning allocation uncommitted while its competitor reaches the constraint
  return r.rows[0].booking as Booking;
});
const release = (run:Run,id:string) => asRole(run,async (c) => {await c.query('select public.release_hold($1)',[id]);});
const closure = (run:Run,resource:string,start:string,end:string) => asRole(run,async (c) => {
  const r = await c.query('select public.create_closure($1,$2,$3,$4) as id',[resource,start,end,'M1 isolated integration proof']);
  return r.rows[0].id as string;
});
async function rejectsCode(operation:Promise<unknown>,code:string) {
  await assert.rejects(operation,(error:unknown) => (error as {code?:string}).code === code);
}

async function main() {
  await verifyProject();
  const missing = ['SUPABASE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new ReadinessError(`NOT RUN: fill ${missing.join(', ')} privately in .env.local for legitimate test identities.`);
  }
  const owner = await connectDatabase();
  const peers: Client[] = [];
  const identities: Identity[] = [];
  const closureIds: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const adminApi = createClient(url,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const runId = randomUUID();
  let completed = 0;
  let failure: unknown;
  async function check(name:string,fn:() => Promise<void>) {
    try {await fn();completed++;console.log(`PASSED: ${name}`);}
    catch(error) {console.error(`FAILED: ${name}; provider details withheld.`);throw error;}
  }
  try {
    await inspectDatabase(owner);
    const schema = await owner.query("select to_regclass('public.allocations') is not null as ready");
    if (!schema.rows[0].ready) throw new ReadinessError('NOT RUN: migrate and seed the verified development database first.');
    for (let i=0;i<3;i++) {
      const password = randomBytes(32).toString('base64url');
      const email = `m1-${runId}-${i}@palmsteeze.invalid`;
      const created = await adminApi.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin'}});
      if (created.error || !created.data.user) throw new ReadinessError('FAILED: legitimate Auth fixture creation failed; provider details withheld.');
      const identity = {id:created.data.user.id,token:''};
      identities.push(identity); // track before sign-in so failed setup still cleans up
      const auth = createClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
      const signed = await auth.auth.signInWithPassword({email,password});
      if (signed.error || !signed.data.session || signed.data.user?.id !== identity.id) {
        throw new ReadinessError('FAILED: fixture sign-in failed; no production authentication bypass was added.');
      }
      const verified = await auth.auth.getUser(signed.data.session.access_token);
      if (verified.error || verified.data.user?.id !== identity.id) throw new ReadinessError('FAILED: Auth could not verify test identity.');
      identity.token = signed.data.session.access_token;
    }
    console.log('PASSED: three genuine Supabase Auth identities signed in and independently verified; no tokens logged.');
    await owner.query("insert into private.app_roles(user_id,role) values($1,'admin')",[identities[2].id]);
    for(let i=0;i<4;i++) peers.push(await connectDatabase());
    const a:Run = {client:peers[0],user:identities[0]};
    const b:Run = {client:peers[1],user:identities[1]};
    const admin:Run = {client:peers[2],user:identities[2]};
    const anon:Run = {client:peers[3],user:null};
    const pids = await Promise.all(peers.map(async (c) => (await c.query('select pg_backend_pid() as pid')).rows[0].pid));
    assert.equal(new Set(pids).size,4);
    console.log('PASSED: four independent session-pooler connections have distinct PostgreSQL backend PIDs.');
    const resourceRows = await owner.query('select code,id from public.resources');
    const ids = Object.fromEntries(resourceRows.rows.map((r) => [r.code,r.id]));
    const date = initialBookingDate(new Date(Date.now()+86400000));
    const at = (hour:number) => intervalFromSelection(date,hour,1).starts_at;
    const seed = readFileSync('supabase/seed.sql','utf8');

    await check('seed twice: exactly 24 desks, 3 rooms, 27 resources, 44 seats and no duplicate rates',async () => {
      await owner.query('begin');
      try {
        const before = await owner.query('select count(*)::int as n from public.resource_rates');
        await owner.query(seed);await owner.query(seed);
        const r = await owner.query(`select count(*)::int as resources,sum(seats)::int as seats,
          count(*) filter(where kind='room')::int as rooms,count(*) filter(where kind <> 'room')::int as desks from public.resources`);
        assert.deepEqual(r.rows[0],{resources:27,seats:44,rooms:3,desks:24});
        assert.equal((await owner.query('select count(*)::int as n from public.resource_rates')).rows[0].n,before.rows[0].n);
      } finally {await owner.query('rollback');}
    });

    await check('concurrent overlapping holds: exactly one commit and one exclusion conflict',async () => {
      let waiting = 0; let open!:() => void;
      const gate = new Promise<void>((resolve) => {open = resolve;});
      const race = {ready:async () => {waiting++;if(waiting === 2) open();await gate;}};
      const outcomes = await Promise.allSettled([hold(a,ids['OPEN-01'],at(10),at(12),randomUUID(),race),hold(b,ids['OPEN-01'],at(11),at(13),randomUUID(),race)]);
      assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length,1);
      const failure = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      assert.equal(failure.reason.code,'23P01');
      const winner = outcomes.findIndex((o) => o.status === 'fulfilled');
      const booking = (outcomes[winner] as PromiseFulfilledResult<Booking>).value;
      const loser = winner === 0 ? identities[1] : identities[0];
      const leaked = await owner.query("select count(*)::int as n from public.bookings where owner_id=$1 and state='held'",[loser.id]);
      assert.equal(leaked.rows[0].n,0);
      await release(winner === 0 ? a : b,booking.id);
    });
    await check('adjacent half-open holds both succeed',async () => {
      const [first,second] = await Promise.all([hold(a,ids['OPEN-02'],at(10),at(11)),hold(b,ids['OPEN-02'],at(11),at(12))]);
      await release(a,first.id);await release(b,second.id);
    });
    await check('closures block holds and closures; adjacent hold succeeds; hold blocks closure',async () => {
      closureIds.push(await closure(admin,ids.COVE,at(10),at(12)));
      await rejectsCode(hold(a,ids.COVE,at(11),at(13)),'23P01');
      await rejectsCode(closure(admin,ids.COVE,at(11),at(13)),'23P01');
      const adjacent = await hold(a,ids.COVE,at(9),at(10));await release(a,adjacent.id);
      const booked = await hold(a,ids['QUIET-01'],at(11),at(12));
      await rejectsCode(closure(admin,ids['QUIET-01'],at(10),at(13)),'23P01');await release(a,booked.id);
    });
    await check('invalid reversed, zero, partial-hour, outside-hours, past and horizon intervals fail',async () => {
      const beyond = intervalFromSelection(initialBookingDate(new Date(Date.now()+40*86400000)),10,1);
      for (const [start,end] of [
        [at(11),at(10)],[at(10),at(10)],
        [new Date(Date.parse(at(10))+1800000).toISOString(),new Date(Date.parse(at(11))+1800000).toISOString()],
        [at(7),at(8)],['2020-01-02T08:00:00Z','2020-01-02T09:00:00Z'],
        [beyond.starts_at,beyond.ends_at],['infinity','infinity'],[at(10),'infinity'],
      ]) await rejectsCode(hold(a,ids['OPEN-03'],start,end),'22023');
      await rejectsCode(closure(admin,ids.CANOPY,at(10),at(9)),'22023');
    });
    await check('transaction rollback removes both booking and allocation',async () => {
      const request = randomUUID();
      await asRole(a,async (c) => {
        await fixtureReservationQuery(c,'select public.create_hold($1,$2,$3,$4)',[ids['OPEN-03'],at(10),at(11),request]);
      },true);
      assert.equal((await owner.query('select count(*)::int as n from public.bookings where request_id=$1',[request])).rows[0].n,0);
      const fresh = await hold(b,ids['OPEN-03'],at(10),at(11));await release(b,fresh.id);
    });
    await check('rate and deposit-policy changes preserve the existing immutable quote snapshot',async () => {
      await asRole(a,async (c) => {
        const result = await fixtureReservationQuery(c,'select public.create_hold($1,$2,$3,$4) as b',[ids['OPEN-04'],at(10),at(12),randomUUID()]);
        const original = result.rows[0].b as Booking;
        assert.equal(original.owner_id,identities[0].id);
        assert.equal(original.hourly_kobo,200000);assert.equal(original.total_kobo,400000);
        assert.equal(original.deposit_percent,40);assert.equal(original.deposit_kobo,160000);
        assert.equal(original.balance_kobo,240000);assert.equal(original.currency,'NGN');
        await c.query('reset role');
        await c.query('insert into public.resource_rates(resource_id,effective_at,hourly_kobo) values($1,now(),400000)',[ids['OPEN-04']]);
        await c.query('update public.venue_settings set deposit_percent=50 where id');
        await c.query(seed); // seed must preserve those intentional changes
        await c.query('set local role authenticated');
        const next = await c.query('select public.quote_resource($1,$2,$3) as q',[ids['OPEN-04'],at(10),at(12)]);
        const stored = await c.query('select hourly_kobo,total_kobo,deposit_percent,deposit_kobo,balance_kobo,currency,policy_snapshot from public.bookings where id=$1',[original.id]);
        assert.equal(next.rows[0].q.hourly_kobo,400000);assert.equal(next.rows[0].q.deposit_percent,50);
        assert.equal(Number(stored.rows[0].hourly_kobo),original.hourly_kobo);
        assert.equal(Number(stored.rows[0].total_kobo),original.total_kobo);
        assert.equal(stored.rows[0].deposit_percent,original.deposit_percent);
        assert.equal(Number(stored.rows[0].deposit_kobo),original.deposit_kobo);
        assert.equal(Number(stored.rows[0].balance_kobo),original.balance_kobo);
        assert.equal(stored.rows[0].currency,original.currency);
        assert.deepEqual(stored.rows[0].policy_snapshot,original.policy_snapshot);
      },true); // restore rate, settings and booking; never alter unrelated data permanently
    });
    await check('same request retries return one hold; stale/changed work and second unresolved hold are rejected',async () => {
      const request = randomUUID();
      const first = await hold(a,ids['OPEN-05'],at(10),at(11),request);
      const retry = await hold(a,ids['OPEN-05'],at(10),at(11),request);assert.equal(retry.id,first.id);
      await rejectsCode(hold(a,ids['OPEN-05'],at(11),at(12),request),'22023');
      await rejectsCode(hold(a,ids['OPEN-06'],at(10),at(11)),'23505');
      await release(a,first.id);await rejectsCode(hold(a,ids['OPEN-05'],at(10),at(11),request),'22023');
    });
    await check('actual anon/authenticated roles enforce ownership, write restrictions and administrator assignment',async () => {
      const own = await hold(a,ids['OPEN-06'],at(10),at(11));
      await asRole(a,async (c) => {assert.equal((await c.query('select id from public.bookings where id=$1',[own.id])).rowCount,1);});
      await asRole(b,async (c) => {
        assert.equal((await c.query('select id from public.bookings where id=$1',[own.id])).rowCount,0);
        assert.equal((await c.query('select id from public.allocations where booking_id=$1',[own.id])).rowCount,0);
        assert.equal((await c.query('select public.is_admin() as admin')).rows[0].admin,false);
      });
      await rejectsCode(release(b,own.id),'42501');
      await rejectsCode(closure(b,ids.CANOPY,at(10),at(11)),'42501');
      for (const query of [
        "update public.bookings set state='released' where id=$1",
        'update public.resource_rates set hourly_kobo=1 where resource_id=$1',
        'update public.bookings set owner_id=$1',
        'update public.bookings set total_kobo=1 where id=$1',
        'update public.venue_settings set deposit_percent=1 where id and $1::uuid is not null',
        "insert into private.app_roles(user_id,role) values($1,'admin')",
        'delete from public.allocations where booking_id=$1',
      ]) await rejectsCode(asRole(b,async (c) => {await c.query(query,[own.id]);}),'42501');
      await asRole(admin,async (c) => {assert.equal((await c.query('select id from public.bookings where id=$1',[own.id])).rowCount,1);});
      await asRole(anon,async (c) => {assert.equal((await c.query('select count(*)::int as n from public.resources')).rows[0].n,27);});
      await rejectsCode(asRole(anon,async (c) => {await c.query('select * from public.bookings');}),'42501');
      await rejectsCode(hold(anon,ids['OPEN-07'],at(10),at(11)),'42501');
      const api = createClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${identities[1].token}`}},auth:{persistSession:false,autoRefreshToken:false}});
      const customerView = await api.from('bookings').select('id').eq('id',own.id);
      assert.equal(customerView.error,null);assert.deepEqual(customerView.data,[]);
      const forbidden = await api.rpc('create_closure',{p_resource:ids.CANOPY,p_start:at(10),p_end:at(11),p_reason:'metadata is not authority'});
      assert.equal(forbidden.error?.code,'42501');
      await release(a,own.id);
    });
    await check('M1 expiry releases only expired test holds; old request cannot reclaim allocation',async () => {
      const request = randomUUID();const old = await hold(a,ids['OPEN-07'],at(10),at(11),request);
      await owner.query("update public.bookings set expires_at=now()-interval '1 second' where id=$1 and owner_id=$2",[old.id,identities[0].id]);
      const next = await hold(b,ids['OPEN-07'],at(10),at(11));
      await rejectsCode(hold(a,ids['OPEN-07'],at(10),at(11),request),'22023');
      assert.equal((await owner.query('select state from public.bookings where id=$1',[old.id])).rows[0].state,'expired');
      await release(b,next.id);
    });
    console.log(`PASSED: ${completed} database proof groups. Google sign-in requires a separate interactive browser check.`);
  } catch(error) { failure = error; }
  {
    // Delete only artifacts belonging to identities and closure IDs created by this run.
    try {
      await owner.query('begin');
      if (identities.length) {
        const userIds = identities.map((u) => u.id);
        await owner.query('delete from public.admin_audit where actor_id=any($1::uuid[])',[userIds]);
        await owner.query('delete from public.allocations where booking_id in (select id from public.bookings where owner_id=any($1::uuid[]))',[userIds]);
        await owner.query('delete from public.bookings where owner_id=any($1::uuid[])',[userIds]);
        await owner.query('delete from private.app_roles where user_id=any($1::uuid[])',[userIds]);
      }
      if (closureIds.length) await owner.query('delete from public.allocations where id=any($1::uuid[]) and kind=\'closure\'',[closureIds]);
      await owner.query('commit');
      for (const identity of identities) {
        const deleted = await adminApi.auth.admin.deleteUser(identity.id);
        if (deleted.error) throw new ReadinessError('FAILED: test Auth identity cleanup needs retry; values withheld.');
      }
      console.log('PASSED: run-owned database/Auth fixtures cleaned up.');
    } catch(error) {
      await owner.query('rollback').catch(() => {});
      console.error('FAILED: cleanup incomplete; rerun-owned artifact review required. Details withheld.');
      if (!failure) failure = error;
    }
    finally {await Promise.all(peers.map((c) => c.end()));await owner.end();}
  }
  if (failure) throw failure;
}
main().catch(safeFailure);
