import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { SiteHeader } from '@/components/site-header';
import {SiteFooter} from '@/components/brand';
import {StatePill} from '@/components/admin-presentation';
import { ReleaseHold } from '@/components/hold-actions';
import { formatMoney } from '@/lib/domain';
import { recoverBooking } from '@/lib/payments';
import {formatWatVisitTime} from '@/lib/visit-dates';
import {reservationNotice} from '@/lib/reservation-notice';
import {customerVisitStatus,customerRefundStatus} from '@/lib/customer-visit-status';
import {JourneyRetry} from '@/components/journey-retry';
import {AccountProfileHeader} from '@/components/account-profile-header';
import {accountProfile} from '@/lib/account-profile';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function Account({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const session = await customerSession();if (!session) redirect('/login?message=session-ended&next=%2Faccount');
  const params = await searchParams;
  const adminRole=await session.client.rpc('is_admin');
  const pending=await session.client.from('payment_attempts').select('booking_id').eq('owner_id',session.user.id).in('state',['creating','open','refund_required']).limit(2);
  if(!pending.error) await Promise.all((pending.data||[]).map(p=>recoverBooking(p.booking_id)));
  const {data,error} = await session.client.from('bookings').select('id,resource_id,starts_at,ends_at,total_kobo,state,expires_at,payment_kind')
    .eq('owner_id',session.user.id).order('created_at',{ascending:false});
  const payments=await session.client.from('payment_attempts').select('booking_id,state,provider_expires_at,cancel_requested,refund_state,refund_blocked,collected_kobo,refunded_kobo').eq('owner_id',session.user.id);
  const cancellations=await session.client.from('cancellation_requests').select('booking_id,state').eq('owner_id',session.user.id).order('created_at',{ascending:false});
  const states=new Map(payments.data?.map(p=>[p.booking_id,p]));
  const resources = await session.client.from('resources').select('id,name');
  const names = new Map(resources.data?.map((r) => [r.id,r.name]));
  const visits=data||[];
  const isUpcoming=(b:typeof visits[number])=>Date.parse(b.starts_at)>=Date.now()&&['confirmed','held'].includes(b.state)&&!(b.payment_kind==='legacy'&&Date.parse(b.expires_at)<=Date.now());
  const upcoming=visits.filter(isUpcoming);const history=visits.filter(b=>!isUpcoming(b));
  function cards(bookings:typeof visits) {
    return <div className="visit-list">{bookings.map(booking=>{
      const expired=booking.payment_kind==='legacy'&&booking.state==='held'&&Date.parse(booking.expires_at)<=Date.now();
      const payment=states.get(booking.id);
      const reservation=reservationNotice(booking,payments.error?null:payment);
      const outcome=customerVisitStatus(booking,payments.error?null:payment);const refund=payment&&!payments.error?customerRefundStatus(payment):null;
      const cancellation=cancellations.data?.find(c=>c.booking_id===booking.id);
      const duration=(Date.parse(booking.ends_at)-Date.parse(booking.starts_at))/3600000;
      return <article className="visit-card" key={booking.id} data-booking-id={booking.id}><div className="visit-state"><p className="eyebrow">{isUpcoming(booking)?'Upcoming visit':'Visit history'}</p><StatePill state={expired?'expired':booking.state}/></div><h2>{names.get(booking.resource_id)||'Workspace'}</h2><p className="visit-time">{formatWatVisitTime(booking.starts_at,booking.ends_at)}<br/>{duration} {duration===1?'hour':'hours'}</p><p className="visit-outcome" data-tone={outcome.tone}>{outcome.title}</p>{reservation&&<p className="reservation-notice">{reservation}</p>}
      <dl className="visit-money"><div><dt>Booking total</dt><dd>{formatMoney(Number(booking.total_kobo))}</dd></div>{payment&&!payments.error&&<><div><dt>Amount paid</dt><dd>{formatMoney(Number(payment.collected_kobo))}</dd></div><div><dt>Amount refunded</dt><dd>{formatMoney(Number(payment.refunded_kobo))}</dd></div><div><dt>{booking.state==='cancelled'?'Remaining refundable amount':'Outstanding balance'}</dt><dd>{formatMoney(booking.state==='cancelled'?Number(payment.collected_kobo)-Number(payment.refunded_kobo):Number(booking.total_kobo)-Number(payment.collected_kobo)+Number(payment.refunded_kobo))}</dd></div></>}</dl>
      {refund&&<p className="visit-refund" data-tone={refund.tone}><strong>{refund.title}.</strong> {refund.message}</p>}{cancellation&&<p className="visit-cancellation">Cancellation request: <strong>{cancellation.state}</strong>. {cancellation.state==='pending'?'Your visit stays confirmed while it is reviewed.':cancellation.state==='approved'?'Refund completion is shown separately.':'View the decision in booking details.'}</p>}
      <Link className="visit-detail" href={`/booking/${booking.id}`}>View booking details <span aria-hidden="true">↗</span></Link>{booking.payment_kind==='legacy'&&booking.state==='held'&&!expired&&<ReleaseHold id={booking.id}/>}</article>;
    })}</div>;
  }
  return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page"><div className="customer-heading"><div><p className="eyebrow">Make room for your day</p><h1>Your <em>account.</em></h1><AccountProfileHeader profile={accountProfile(session.user)}/></div><form method="post" action="/auth/sign-out"><button className="button button-secondary" type="submit">Sign out</button></form></div>
    {adminRole.data===true&&<p><Link className="button" href="/admin">Open administration</Link></p>}
    {params.message==='signout-failed'&&<p className="auth-notice" role="status">Sign-out failed. Your session may still be active. Retry.</p>}
    <p className="signin-note">Times shown in WAT</p>
    {error?<section className="journey-status" data-tone="warning"><h2>Your visits couldn’t be loaded</h2><p role="status">Try again to check existing bookings before making another payment.</p><JourneyRetry label="Load your visits again"/></section>:!visits.length?<div className="empty-state"><span aria-hidden="true">↗</span><h2>Your next good workday awaits.</h2><p>No visits yet.</p><Link className="button" href="/#plan">Find your space</Link></div>:<>{(payments.error||cancellations.error)&&<section className="journey-status" data-tone="warning"><h2>Some details need checking</h2><p role="status">{payments.error?'Payment amounts are unavailable. ':''}{cancellations.error?'Cancellation status is unavailable. Retry before requesting again.':''}</p><JourneyRetry label="Check visit details again"/></section>}<h2 className="visit-group-title">Upcoming <span>{upcoming.length}</span></h2>{upcoming.length?cards(upcoming):<div className="empty-state"><h3>A little room in your calendar.</h3><p>No upcoming visits. <Link href="/#plan">Plan your next one.</Link></p></div>}<h2 className="visit-group-title">History & cancelled visits <span>{history.length}</span></h2>{history.length?cards(history):<p>Past and cancelled visits will appear here.</p>}<Link className="button" href="/#plan">Plan another visit ↗</Link></>}
    </main><SiteFooter/></>;
}
