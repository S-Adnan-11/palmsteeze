import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dateOnly,dateEntry,parseDateEntry,formatVisitDate,formatWatDateTime} from '../../src/lib/visit-dates';
import {reservationNotice} from '../../src/lib/reservation-notice';

test('readable calendar days and WAT timestamps never follow the browser timezone',()=>{
  const original=process.env.TZ;
  try {for(const zone of ['Pacific/Honolulu','Pacific/Kiritimati','America/Los_Angeles','Europe/London','Africa/Lagos']) {
    process.env.TZ=zone;
    assert.equal(formatVisitDate('2026-10-09'),'Fri, 9 Oct 2026');
    assert.equal(formatWatDateTime('2026-10-08T23:30:00Z'),'Fri, 9 Oct 2026 · 00:30 WAT');
    assert.equal(dateEntry('2026-10-09'),'09/10/2026');
    assert.equal(parseDateEntry('09/10/2026'),'2026-10-09');
  }} finally {if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('explicit day/month/year entry rejects impossible or ambiguous dates',()=>{
  assert.equal(parseDateEntry('29/02/2028'),'2028-02-29');
  for(const value of ['29/02/2026','31/04/2026','09/13/2026','9/10/26','10/09/26','2026-10-09','']) assert.equal(parseDateEntry(value),null);
  for(const value of ['2026-02-29','2026-04-31','2026-13-01','2026-10-9','invalid']) assert.equal(dateOnly(value),undefined);
});
test('only actual held bookings show temporary reservations and verified stored deadlines',()=>{
  const now=Date.parse('2026-10-09T09:00:00Z');
  const booking={state:'held',payment_kind:'checkout',expires_at:'2026-10-09T09:10:00Z'};
  assert.equal(reservationNotice({...booking,state:'confirmed'},null,now),null);
  assert.equal(reservationNotice({...booking,state:'cancelled'},null,now),null);
  assert.match(reservationNotice({...booking,payment_kind:'legacy'},null,now)!,/expires Fri, 9 Oct 2026 · 10:10 WAT/);
  assert.equal(reservationNotice({...booking,payment_kind:'legacy'},null,now+600001),'This unpaid temporary reservation has expired.');
  assert.match(reservationNotice(booking,{state:'creating',provider_expires_at:null},now)!,/while checkout is prepared/);
  assert.match(reservationNotice(booking,{state:'open',provider_expires_at:'2026-10-09T09:30:00Z'},now)!,/complete checkout by Fri, 9 Oct 2026 · 10:30 WAT/);
  assert.match(reservationNotice(booking,{state:'open',provider_expires_at:'2026-10-09T09:30:00Z'},now+1800001)!,/space stays held while payment is checked/);
  assert.match(reservationNotice(booking,{state:'review_required',provider_expires_at:null},now)!,/stays held while payment is checked/);
});
