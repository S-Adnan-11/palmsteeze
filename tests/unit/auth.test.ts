import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeDestination,visitDestination,visitSelection } from '../../src/lib/auth/destinations';
const selection = {resource:'00000000-0000-4000-8000-000000000025',date:'2026-10-05',hour:10,duration:2};
test('auth destinations accept only known pages and a complete non-authoritative visit selection',() => {
  assert.equal(safeDestination('/account'),'/account');assert.equal(safeDestination('/'),'/');
  const detail=`/booking/${selection.resource}`;assert.equal(safeDestination(detail),detail);
  assert.equal(safeDestination(`${detail}?next=https://evil.example`),null);
  assert.equal(safeDestination('/booking/not-a-uuid'),null);
  assert.equal(safeDestination('/admin'),'/admin');
  assert.equal(safeDestination('/admin/refund-assistance'),'/admin/refund-assistance');
  assert.equal(safeDestination('/admin/refund-assistance?next=https://evil.example'),null);
  assert.equal(safeDestination(`/admin/bookings/${selection.resource}`),`/admin/bookings/${selection.resource}`);
  assert.equal(safeDestination('/admin?role=admin'),null);assert.equal(safeDestination('/admin/roles'),null);
  const visit = visitDestination(selection);assert.equal(safeDestination(visit),visit);
  assert.deepEqual(visitSelection(new URL(visit,'https://application.invalid').searchParams),selection);
  assert.equal(safeDestination(`${visit}&price=1`),null);
  assert.equal(safeDestination(`${visit}&resource=${selection.resource}`),null);
  assert.equal(safeDestination(visit.replace('2026-10-05','2026-02-30')),null);
});
test('auth destinations reject external, encoded, protocol-relative, traversal and injected redirects',() => {
  for (const target of ['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/a/../account','/account#evil','/account?next=https://evil.example','/auth/callback','javascript:alert(1)',' /account','/account\n','/%252f%252fevil.example']) {
    assert.equal(safeDestination(target),null);
  }
});
