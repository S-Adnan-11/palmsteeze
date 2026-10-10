type Visit={state:string;payment_kind:string;expires_at:string};
type Payment={state:string;refund_state:string;refund_blocked:boolean;cancel_requested?:boolean;collected_kobo:number;refunded_kobo:number};
type Status={title:string;message:string;tone:'neutral'|'success'|'warning'|'danger'};
// Presentation of stored, verified records only. Return URL parameters never
// supply state, money or confirmation. Unknown records remain unknown.
export function customerVisitStatus(booking:Visit,payment:Payment|null|undefined,now=Date.now()):Status {
  if(booking.payment_kind==='legacy') {
    if(booking.state==='held'&&Date.parse(booking.expires_at)>now) return {title:'Temporarily reserved',message:'Unpaid hold. Review a new visit to pay.',tone:'neutral'};
    return {title:booking.state==='released'?'Reservation released':'Reservation expired',message:'This unpaid hold ended. You can plan a new visit.',tone:'neutral'};
  }
  if(!payment) return {title:'Payment status unavailable',message:'Refresh this booking before making another payment.',tone:'warning'};
  if(payment.refund_blocked) return {title:'Refund needs assistance',message:booking.state==='cancelled'?'Your visit is cancelled, but reimbursement is still outstanding.':'Your visit was not confirmed and reimbursement is still outstanding.',tone:'danger'};
  if(booking.state==='confirmed'&&payment.state==='paid') return {title:'Your visit is confirmed',message:'Test payment verified. Any remaining balance is simulated.',tone:'success'};
  if(booking.state==='cancelled') return {title:'Your visit is cancelled',message:'Check refund progress below for returned and outstanding amounts.',tone:'neutral'};
  if(['refund_required','refunded'].includes(payment.state)) return {title:'Your space could not be confirmed',message:'Payment received; no replacement booked. Check refund progress below.',tone:'warning'};
  if(payment.state==='creation_failed') return {title:'Checkout could not be opened',message:'No payment created. Your space is no longer held.',tone:'danger'};
  if(payment.state==='expired') return {title:'Checkout ended without payment',message:'Checkout expired without payment. Your space is no longer held.',tone:'neutral'};
  if(payment.state==='review_required') return {title:'Payment needs checking',message:'Visit unconfirmed. Refresh this booking before starting another payment.',tone:'warning'};
  if(payment.cancel_requested) return {title:'Stopping unpaid checkout',message:'Checking payment before releasing the space. Refresh for the result.',tone:'neutral'};
  return {title:payment.state==='open'?'Payment not confirmed yet':payment.state==='creating'?'Preparing your checkout':'Payment needs checking',message:'Continue payment or refresh this booking for the result.',tone:'neutral'};
}
export function customerRefundStatus(payment:Payment):Status|null {
  const collected=Number(payment.collected_kobo);const returned=Number(payment.refunded_kobo);
  if(payment.refund_blocked) return {title:'Reimbursement outstanding',message:'Stripe permanently refused the refund. Automatic retries have stopped; administrator assistance is required.',tone:'danger'};
  if(payment.refund_state==='none') return null;
  if(collected>0&&returned===collected&&payment.refund_state==='succeeded') return {title:'Payment returned',message:'Full test payment verified as refunded.',tone:'success'};
  if(payment.refund_state==='succeeded') return {title:returned>0?'Part of your payment returned':'Refund status needs checking',message:'Only the refunded amount below has been verified as returned.',tone:'warning'};
  if(payment.refund_state==='failed'||payment.state==='review_required') return {title:'Refund needs checking',message:'Remaining reimbursement unverified. Administrator review needed.',tone:'warning'};
  return {title:'Refund in progress',message:'Cancellation approved; reimbursement is not complete.',tone:'neutral'};
}
