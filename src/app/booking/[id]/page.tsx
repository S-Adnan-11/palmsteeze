import Link from 'next/link';
import { redirect,notFound } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { customerBooking,hostedCheckoutURL } from '@/lib/payments';
import { SiteHeader } from '@/components/site-header';
import { CheckoutStatusActions,RequestCancellation } from '@/components/checkout-actions';
import { ReleaseHold } from '@/components/hold-actions';
import { formatMoney,uuidPattern } from '@/lib/domain';
import {SiteFooter} from '@/components/brand';
import {StatePill} from '@/components/admin-presentation';
import {CopyReference} from '@/components/copy-reference';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function BookingDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!uuidPattern.test(id)) notFound();
  const session=await customerSession();if(!session) redirect(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);
  let detail;
  try {detail=await customerBooking(session.client,id);}catch {
    return <><SiteHeader/><main id="main" className="customer-page"><h1>Checking your <em>visit.</em></h1><p role="status">Your booking service is temporarily unavailable. Refresh to verify its status; payment is never assumed from the return URL.</p><Link href="/account">Your visits</Link></main></>;
  }
  if(!detail) notFound();const {booking,payment}=detail;
  const resource=await session.client.from('resources').select('name').eq('id',booking.resource_id).maybeSingle();
  const cancellations=await session.client.from('cancellation_requests').select('id,state,reason,decision_reason,created_at,decided_at').eq('booking_id',id).order('created_at',{ascending:false});
  const url=payment?.state==='open'&&!payment.cancel_requested ? hostedCheckoutURL(payment.checkout_url):null;
  const legacy=booking.payment_kind==='legacy';const expiredLegacy=legacy&&booking.state==='held'&&Date.parse(booking.expires_at)<=Date.now();
  return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page booking-detail"><p className="eyebrow">Your visit · {id.slice(0,8).toUpperCase()}</p><h1>{resource.data?.name||'Your'} <em>booking.</em></h1>
    <p>{new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}).format(new Date(booking.starts_at))} WAT</p>
    <div className="booking-state-strip"><p data-testid="booking-state">Booking: <StatePill state={expiredLegacy?'expired':booking.state}/></p><p data-testid="payment-state">Payment: <StatePill state={payment?.state||'legacy unpaid'}/></p><p data-testid="refund-state">Refund: <StatePill state={payment?.refund_blocked?'failed — assistance required':payment?.refund_state||'none'}/></p></div>
    <div className="quote-summary"><p><span>Booking total</span><strong>{formatMoney(Number(booking.total_kobo))}</strong></p><p><span>{booking.deposit_percent}% minimum deposit</span><strong>{formatMoney(Number(booking.deposit_kobo))}</strong></p>
    {payment&&<p><span>Selected payment</span><strong>{formatMoney(Number(payment.amount_kobo))}</strong></p>}
    <p><span>Amount paid</span><strong>{formatMoney(Number(payment?.collected_kobo||0))}</strong></p><p><span>Amount refunded</span><strong>{formatMoney(Number(payment?.refunded_kobo||0))}</strong></p>
    <p><span>{booking.state==='cancelled' ? 'Remaining refundable amount':'Outstanding balance at venue'}</span><span>{formatMoney(booking.state==='cancelled' ? Number(payment?.collected_kobo||0)-Number(payment?.refunded_kobo||0):Number(booking.total_kobo)-Number(payment?.collected_kobo||0)+Number(payment?.refunded_kobo||0))}</span></p></div>
    {payment?.refund_blocked&&<section className="refund-assistance" role="status"><h2>Refund failed. We need to help.</h2><p>{booking.state==='cancelled' ? 'Your cancellation remains approved.':'Your visit has not been confirmed.'} Stripe could not return your payment and has permanently refused the refund request. Automatic retries have stopped.</p><p><strong>{formatMoney(Number(payment.collected_kobo)-Number(payment.refunded_kobo))} still needs to be reimbursed.</strong> Contact the workspace administrator with booking reference <span className="reference">{id}</span>. This obligation remains unresolved.</p></section>}
    {cancellations.error ? <p>Cancellation status could not be loaded; refresh before sending another request.</p>
      : <>{cancellations.data?.map(c=><section className="cancellation-history" key={c.id}><p className="eyebrow">Cancellation history</p><p data-testid="cancellation-state">Cancellation request: {c.state} · {c.reason}</p>{c.decision_reason&&<p>Decision reason: {c.decision_reason}</p>}{c.decided_at&&<p>Decided {new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}).format(new Date(c.decided_at))} WAT</p>}</section>)}
      {booking.state==='confirmed'&&payment?.state==='paid'&&Date.parse(booking.starts_at)>Date.now()&&!cancellations.data?.some(c=>c.state==='pending')&&<><p>{cancellations.data?.length ? 'You may submit another eligible request with a new reason. Previous decisions remain in your history.':''}</p><RequestCancellation id={id}/></>}</>}
    {legacy ? <><p>This pre-payment hold is unpaid. Its original snapshot is retained; choose a fresh reviewed visit for checkout.</p>{booking.state==='held'&&!expiredLegacy&&<ReleaseHold id={id}/>}</>
      : <>{payment?.state==='paid'&&booking.state==='confirmed' ? <p className="auth-notice" role="status">Your payment was verified with Stripe. Your visit is confirmed; any outstanding balance is due at the venue.</p>
        : payment?.state==='refund_required'||payment?.state==='refunded' ? <p role="status">{booking.state==='cancelled' ? 'Your cancellation was approved. The visit is cancelled.':'Payment arrived without an owned allocation. We have not confirmed or substituted a space.'} Full collected-payment sandbox refund: {payment.refund_state}.</p>
        : payment?.state==='creation_failed' ? <p role="status">Stripe rejected checkout setup before any payment was created. The allocation was released safely; choose a fresh reviewed visit.</p>
        : payment?.state==='expired' ? <p role="status">Stripe verified this checkout is expired and unpaid. The allocation has been released.</p>
        : payment?.state==='review_required' ? <p role="status">{booking.state==='cancelled' ? 'Your visit remains cancelled. The payment refund needs administrator attention; it has not been verified as returned.':'This payment needs administrator reconciliation. Your allocation is protected while the provider outcome is uncertain; do not pay through a new booking.'}</p>
        : <p role="status">Payment is pending verification. Browser return messages and countdowns do not confirm payment or release your space.</p>}
      {url&&<a className="button" href={url}>Continue to secure Stripe sandbox checkout</a>}
      {payment?.provider_expires_at&&<p>Stripe checkout deadline: {new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',timeStyle:'short'}).format(new Date(payment.provider_expires_at))} WAT. Verification controls release.</p>}
      <CheckoutStatusActions id={id} initialState={payment?.state||'creating'} canCancel={Boolean(payment&&['creating','open'].includes(payment.state)&&!payment.cancel_requested)}/></>}
    <details className="booking-reference-detail"><summary>Booking reference</summary><CopyReference value={id}/><p className="signin-note">Your original booking price and deposit remain attached to this visit.</p></details><p className="payment-disclosure">Demo workspace. Test payments only.</p><p><Link href="/account">Your visits</Link> · <Link href="/#plan">Plan another visit</Link></p></main><SiteFooter/></>;
}
