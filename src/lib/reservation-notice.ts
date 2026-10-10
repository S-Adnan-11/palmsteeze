import {formatWatDateTime} from './visit-dates';
type Booking={state:string;payment_kind:string;expires_at:string};
type Payment={state:string;provider_expires_at:string|null};
// Only a stored booking can have a reservation. A deadline does not release
// an uncertain payment-backed allocation; provider verification still does.
export function reservationNotice(booking:Booking,payment:Payment|null|undefined,now=Date.now()) {
  if(booking.state!=='held') return null;
  if(booking.payment_kind==='legacy') return Date.parse(booking.expires_at)>now
    ? 'Temporary reservation · expires '+formatWatDateTime(booking.expires_at)+'. No payment has been collected.'
    : 'This unpaid temporary reservation has expired.';
  if(payment?.state==='open'||payment?.state==='creating') {
    if(payment.provider_expires_at) return Date.parse(payment.provider_expires_at)>now
      ? 'Temporarily reserved · complete checkout by '+formatWatDateTime(payment.provider_expires_at)+'. Payment is not confirmed yet.'
      : 'Checkout deadline passed ('+formatWatDateTime(payment.provider_expires_at)+'). Your space stays held while payment is checked.';
    return 'Your space is temporarily held while checkout is prepared. Payment is not confirmed yet.';
  }
  return 'Your space stays held while payment is checked. Please use this booking before starting another.';
}
