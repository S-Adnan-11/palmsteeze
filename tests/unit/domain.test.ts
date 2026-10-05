import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingQuote,workingDefaults,intervalFromSelection,validateInterval,initialBookingDate,exactObject,parseNaira,formatMoney } from '../../src/lib/domain';
import { previewResources } from '../../src/lib/fixtures';

test('inventory is 24 single desks and 3 whole rooms, totalling 44 seats',() => {
  assert.equal(previewResources.length,27);
  assert.equal(new Set(previewResources.map((r) => r.code)).size,27);
  assert.equal(previewResources.filter((r) => r.kind !== 'room').length,24);
  assert.deepEqual(previewResources.filter((r) => r.kind === 'room').map((r) => r.seats),[4,6,10]);
  assert.equal(previewResources.reduce((sum,r) => sum+r.seats,0),44);
});
test('quotes use integer half-up kobo rounding and preserve total = deposit + balance',() => {
  assert.deepEqual(workingQuote(200000,1,30),{total_kobo:200000,deposit_kobo:60000,balance_kobo:140000});
  assert.deepEqual(workingQuote(5,1,30),{total_kobo:5,deposit_kobo:2,balance_kobo:3});
  assert.throws(() => workingQuote(2.1,1,30));
  assert.throws(() => workingQuote(Number.MAX_SAFE_INTEGER,2,30));
});
test('Lagos selection is explicit, independent of the OS timezone',() => {
  assert.deepEqual(intervalFromSelection('2026-10-02',8,2),{starts_at:'2026-10-02T07:00:00.000Z',ends_at:'2026-10-02T09:00:00.000Z'});
  assert.throws(() => intervalFromSelection('2026-02-30',8,1));
  assert.throws(() => intervalFromSelection('2026-10-02',23,2));
  assert.equal(initialBookingDate(new Date('2026-10-03T12:00:00Z')),'2026-10-05');
});
test('interval prevalidation accepts closing boundary and rejects Sunday/past/partial/cross-day/horizon',() => {
  const now = new Date('2026-10-01T06:00:00Z');
  assert.doesNotThrow(() => validateInterval('2026-10-01T18:00:00Z','2026-10-01T19:00:00Z',workingDefaults,now));
  const bad = [
    ['2026-10-04T08:00:00Z','2026-10-04T09:00:00Z'],
    ['2026-10-01T05:00:00Z','2026-10-01T06:00:00Z'],
    ['2026-10-02T08:30:00Z','2026-10-02T09:30:00Z'],
    ['2026-10-02T18:00:00Z','2026-10-03T08:00:00Z'],
    ['2026-11-02T08:00:00Z','2026-11-02T09:00:00Z'],
    ['2026-10-02T08:00:00Z','2026-10-02T08:00:00Z'],
    ['2026-10-02T08:00:00','2026-10-02T09:00:00'],
  ];
  for (const [start,end] of bad) assert.throws(() => validateInterval(start,end,workingDefaults,now));
});
test('mutation payloads reject client-controlled owner, price, role and state',() => {
  const required = ['resourceId','startsAt','endsAt','requestId'];
  const body = {resourceId:'resource',startsAt:'start',endsAt:'end',requestId:'request'};
  assert.doesNotThrow(() => exactObject(body,required));
  for (const key of ['ownerId','hourlyKobo','role','state']) assert.throws(() => exactObject({...body,[key]:'forged'},required));
  assert.throws(() => exactObject({...body,requestId:7},required));
});
test('naira decimal entry converts exactly to integer kobo and rejects ambiguous money',()=>{
 assert.equal(parseNaira('800'),80000);assert.equal(parseNaira('1500.01'),150001);assert.equal(parseNaira('0.29'),29);
 for(const value of ['0.001','-1','1e3','1,000','NaN',' 800','90071992547410']) assert.throws(()=>parseNaira(value));
 assert.match(formatMoney(29),/0\.29/);assert.match(formatMoney(80000),/800/);assert.throws(()=>formatMoney(1.5));
});
