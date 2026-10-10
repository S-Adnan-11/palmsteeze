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
import {formatWatDateTime,formatWatVisitTime} from '@/lib/visit-dates';
import {reservationNotice} from '@/lib/reservation-notice';
import {customerVisitStatus,customerRefundStatus} from '@/lib/customer-visit-status';
import {JourneyRetry} from '@/components/journey-retry';
import {SandboxCard} from '@/components/sandbox-card';
import {accountProfile} from '@/lib/account-profile';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function BookingDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!uuidPattern.test(id)) notFound();
  const session=await customerSession();if(!session) redirect(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);
  let detail;
  try {detail=await customerBooking(session.client,id);}catch {
    return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page"><h1>Let’s check your <em>visit.</em></h1><section className="journey-status" data-tone="warning"><h2>Status unavailable</h2><p role="status">Status is unavailable. Retry here before making another payment.</p><JourneyRetry label="Check this booking again"/></section><Link href="/account">Your visits</Link></main><SiteFooter/></>;
  }
  if(!detail) notFound();const {booking,payment}=detail;
  const resource=await session.client.from('resources').select('name').eq('id',booking.resource_id).maybeSingle();
  const cancellations=await session.client.from('cancellation_requests').select('id,state,reason,decision_reason,created_at,decided_at').eq('booking_id',id).order('created_at',{ascending:false});
  const url=payment?.state==='open'&&!payment.cancel_requested ? hostedCheckoutURL(payment.checkout_url):null;
  const legacy=booking.payment_kind==='legacy';const expiredLegacy=legacy&&booking.state==='held'&&Date.parse(booking.expires_at)<=Date.now();
  const reservation=reservationNotice(booking,payment);
  const outcome=customerVisitStatus(booking,payment);const refund=payment?customerRefundStatus(payment):null;
  return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page booking-detail"><p className="eyebrow">Your visit · {id.slice(0,8).toUpperCase()}</p><h1>{resource.data?.name||'Your'} <em>booking.</em></h1>
    <p className="visit-time">{formatWatVisitTime(booking.starts_at,booking.ends_at)} <span>· {(Date.parse(booking.ends_at)-Date.parse(booking.starts_at))/3600000} {(Date.parse(booking.ends_at)-Date.parse(booking.starts_at))===3600000?'hour':'hours'}</span></p>
    <div className="visit-detail-layout"><div className="visit-detail-main"><section className="journey-status" data-tone={outcome.tone} aria-labelledby="visit-outcome"><p className="eyebrow">Booking status</p><h2 id="visit-outcome">{outcome.title}</h2><p role="status">{outcome.message}</p>
    {reservation&&<p className="reservation-notice">{reservation}</p>}
    {!legacy&&<>{url&&process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED==='true'&&<SandboxCard bookingId={id} createdAt={booking.created_at} displayName={accountProfile(session.user).name}/>}<div className="journey-actions">{url&&<a className="button" href={url}>Continue to test payment</a>}{payment&&['creation_failed','expired'].includes(payment.state)&&<Link className="button" href="/#plan">Plan another visit</Link>}</div><CheckoutStatusActions id={id} initialState={payment?.state||'unavailable'} canCancel={Boolean(payment&&['creating','open'].includes(payment.state)&&!payment.cancel_requested)}/></>}
    {legacy&&booking.state==='held'&&!expiredLegacy&&<ReleaseHold id={id}/>}</section>
    {refund&&payment&&<section className={'journey-status refund-progress'+(payment.refund_blocked?' refund-assistance':'')} data-tone={refund.tone} aria-label="Refund progress"><p className="eyebrow">Refund progress</p><h2>{refund.title}</h2><p>{refund.message}</p><dl className="visit-money"><div><dt>Verified refunded</dt><dd>{formatMoney(Number(payment.refunded_kobo))}</dd></div><div><dt>Still to be reimbursed</dt><dd>{formatMoney(Number(payment.collected_kobo)-Number(payment.refunded_kobo))}</dd></div></dl>{payment.refund_blocked&&<p>Contact the workspace administrator with booking reference <span className="reference">{id}</span>.</p>}</section>}
    <section className="visit-management" aria-labelledby="visit-changes"><h2 id="visit-changes">Changes to your visit</h2>
    {cancellations.error ? <><p role="status">Cancellation status could not be loaded. Check again before sending another request.</p><JourneyRetry label="Check cancellation status"/></>
      : <>{cancellations.data?.map(c=><section className="cancellation-history" key={c.id}><p data-testid="cancellation-state"><strong>Cancellation request: {c.state}</strong></p><p>{c.reason}</p><p className="field-help">Requested {formatWatDateTime(c.created_at)}</p>{c.state==='pending'&&<p>Decision pending. Your visit stays confirmed.</p>}{c.state==='approved'&&<p>Cancellation approved. Check refund progress above.</p>}{c.decision_reason&&<p>Decision reason: {c.decision_reason}</p>}{c.decided_at&&<p className="field-help">Decided {formatWatDateTime(c.decided_at)}</p>}</section>)}
      {!cancellations.data?.length&&<p>No cancellation requests for this visit.</p>}
      {booking.state==='confirmed'&&payment?.state==='paid'&&Date.parse(booking.starts_at)>Date.now()&&!cancellations.data?.some(c=>c.state==='pending')&&<>{Boolean(cancellations.data?.length)&&<p>You can request again with a new reason.</p>}<RequestCancellation id={id}/></>}</>}
    </section></div><aside className="visit-financial-panel" aria-label="Booking payment summary"><h2>Your payment</h2><div className="quote-summary"><p><span>Booking total</span><strong>{formatMoney(Number(booking.total_kobo))}</strong></p><p><span>{booking.deposit_percent}% minimum deposit</span><strong>{formatMoney(Number(booking.deposit_kobo))}</strong></p>
    {payment&&<p><span>Chosen initial payment</span><strong>{formatMoney(Number(payment.amount_kobo))}</strong></p>}
    {payment||legacy?<><p><span>Amount paid</span><strong>{formatMoney(Number(payment?.collected_kobo||0))}</strong></p><p><span>Amount refunded</span><strong>{formatMoney(Number(payment?.refunded_kobo||0))}</strong></p>
    <p><span>{booking.state==='cancelled' ? 'Remaining refundable amount':'Simulated balance'}</span><strong>{formatMoney(booking.state==='cancelled' ? Number(payment?.collected_kobo||0)-Number(payment?.refunded_kobo||0):Number(booking.total_kobo)-Number(payment?.collected_kobo||0)+Number(payment?.refunded_kobo||0))}</strong></p></>:<p>Paid, refunded and remaining amounts could not be verified. Check this booking again.</p>}</div>
    <div className="booking-state-strip"><p data-testid="booking-state">Booking: <StatePill state={expiredLegacy?'expired':booking.state}/></p><p data-testid="payment-state">Payment: <StatePill state={payment?.state||(legacy?'unpaid':'unavailable')}/></p><p data-testid="refund-state">Refund: <StatePill state={payment?.refund_blocked?'failed — assistance required':payment?.refund_state||(legacy?'none':'unavailable')}/></p></div>
    <details className="booking-reference-detail"><summary>Booking reference</summary><CopyReference value={id}/></details></aside></div><p className="customer-back-links"><Link href="/account">Your visits</Link>{(expiredLegacy||booking.state!=='held')&&payment?.state!=='review_required'&&<> · <Link href="/#plan">Plan another visit</Link></>}</p></main><SiteFooter/></>;
}
