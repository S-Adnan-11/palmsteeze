import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingDateRange,eligibleHours,contiguousDurations} from '../../src/lib/booking-options';
import {workingDefaults} from '../../src/lib/domain';
import {editVisitDestination,visitSelection,visitDestination,safeDestination} from '../../src/lib/auth/destinations';

test('whole-hour options obey WAT lead time, closing hour, open weekdays and horizon',()=>{
  const now=new Date('2026-10-07T08:30:00Z');
  assert.equal(eligibleHours('2026-10-07',workingDefaults,now)[0],11);
  assert.equal(eligibleHours('2026-10-07',workingDefaults,now).at(-1),19);
  for(const date of ['2026-10-11','2026-11-07','2026-02-30','2026-10-06','invalid']) assert.deepEqual(eligibleHours(date,workingDefaults,now),[]);
  assert.equal(eligibleHours('2026-11-06',workingDefaults,now).length,12);
  assert.deepEqual(bookingDateRange(workingDefaults,new Date('2026-10-07T23:30Z')),{min:'2026-10-08',max:'2026-11-07'});
});
test('durations cannot cross occupied hours or missing slots, even if a later hour is free',()=>{
  const slots=[{hour:10,available:true},{hour:11,available:true},{hour:12,available:false},{hour:13,available:true},{hour:15,available:true}];
  assert.deepEqual(contiguousDurations(10,slots),[1,2]);
  assert.deepEqual(contiguousDurations(12,slots),[]);
  assert.deepEqual(contiguousDurations(13,slots),[1]);
  assert.deepEqual(contiguousDurations(20,slots),[]);
});
test('editable return carries only exact visit selection and leaves auth allowlist strict',()=>{
  const selection={resource:'12345678-1234-4234-8234-123456789012',date:'2026-10-08',hour:10,duration:2};
  const edit=new URL(editVisitDestination(selection),'https://app.invalid');
  assert.equal(edit.pathname,'/');assert.equal(edit.hash,'#plan');assert.deepEqual(visitSelection(edit.searchParams),selection);
  assert.equal(safeDestination(visitDestination(selection)),visitDestination(selection));
  assert.equal(safeDestination(edit.pathname+edit.search+edit.hash),null);
  edit.searchParams.set('amount','1');assert.equal(visitSelection(edit.searchParams),null);
});
