import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerVisitStatus,customerRefundStatus} from '../../src/lib/customer-visit-status';
import {formatWatVisitTime} from '../../src/lib/visit-dates';
const booking={state:'held',payment_kind:'checkout',expires_at:'2026-10-10T10:00:00Z'};
const payment={state:'open',refund_state:'none',refund_blocked:false,collected_kobo:0,refunded_kobo:0};
test('confirmation requires both verified booking and payment; unknown and stopped checkout stay distinct',()=>{
  assert.match(customerVisitStatus(booking,null).title,/unavailable/);
  assert.equal(customerVisitStatus(booking,{...payment,state:'paid'}).title,'Payment needs checking');
  assert.equal(customerVisitStatus({...booking,state:'confirmed'},payment).title,'Payment not confirmed yet');
  assert.equal(customerVisitStatus({...booking,state:'confirmed'},{...payment,state:'paid'}).title,'Your visit is confirmed');
  assert.equal(customerVisitStatus(booking,{...payment,cancel_requested:true}).title,'Stopping unpaid checkout');
  assert.equal(customerVisitStatus({...booking,state:'expired'},{...payment,state:'expired'}).title,'Checkout ended without payment');
  assert.equal(customerVisitStatus({...booking,state:'released'},{...payment,state:'creation_failed'}).title,'Checkout could not be opened');
});
test('accepted cancellation and partial or permanently failed refunds never imply reimbursement completion',()=>{
  const partial={...payment,state:'refund_required',refund_state:'pending',collected_kobo:300001,refunded_kobo:100001};
  assert.equal(customerVisitStatus({...booking,state:'cancelled'},partial).title,'Your visit is cancelled');
  assert.equal(customerRefundStatus(partial)?.title,'Refund in progress');
  assert.equal(customerRefundStatus({...partial,refund_state:'succeeded'})?.title,'Part of your payment returned');
  assert.equal(customerRefundStatus({...partial,refunded_kobo:300001,refund_state:'succeeded'})?.title,'Payment returned');
  const failed={...partial,state:'review_required',refund_state:'failed',refund_blocked:true};
  assert.equal(customerVisitStatus({...booking,state:'cancelled'},failed).title,'Refund needs assistance');
  assert.match(customerRefundStatus(failed)!.message,/Automatic retries have stopped/);
  assert.equal(customerRefundStatus({...payment,refund_state:'succeeded'})?.title,'Refund status needs checking');
});
test('customer visit ranges use Lagos dates and time in browsers on either side of the date line',()=>{
  const original=process.env.TZ;
  try{for(const zone of ['Pacific/Honolulu','Pacific/Kiritimati']){process.env.TZ=zone;assert.equal(formatWatVisitTime('2026-10-09T07:00:00Z','2026-10-09T09:00:00Z'),'Fri, 9 Oct 2026 · 08:00–10:00 WAT');}}
  finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
