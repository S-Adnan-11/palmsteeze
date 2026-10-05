import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { SiteHeader } from '@/components/site-header';
import {SiteFooter} from '@/components/brand';
import {StatePill} from '@/components/admin-presentation';
import { ReleaseHold } from '@/components/hold-actions';
import { formatMoney } from '@/lib/domain';
import { recoverBooking } from '@/lib/payments';
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
  const payments=await session.client.from('payment_attempts').select('booking_id,state,refund_state,refund_blocked,collected_kobo,refunded_kobo').eq('owner_id',session.user.id);
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
      return <article className="visit-card" key={booking.id} data-booking-id={booking.id}><div className="visit-state"><p className="eyebrow">Your workspace</p><StatePill state={expired?'expired':booking.state}/></div><h2>{names.get(booking.resource_id)||'Workspace'}</h2><p>{new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}).format(new Date(booking.starts_at))} WAT</p><p className="visit-total">Total quote: {formatMoney(Number(booking.total_kobo))}</p><p>Payment: {payment?.state||(booking.payment_kind==='legacy'?'legacy unpaid':'unavailable')} · Refund: {payment?.refund_blocked?'failed — assistance required':payment?.refund_state||'none'}</p>{payment&&<><p>Amount paid: {formatMoney(Number(payment.collected_kobo))} · Refunded: {formatMoney(Number(payment.refunded_kobo))}</p><p>{booking.state==='cancelled'?`Remaining refundable amount: ${formatMoney(Number(payment.collected_kobo)-Number(payment.refunded_kobo))}`:`Outstanding balance: ${formatMoney(Number(booking.total_kobo)-Number(payment.collected_kobo)+Number(payment.refunded_kobo))}`}</p></>}<Link className="visit-detail" href={`/booking/${booking.id}`}>View booking details <span aria-hidden="true">↗</span></Link>{booking.payment_kind==='legacy'&&booking.state==='held'&&!expired&&<ReleaseHold id={booking.id}/>}</article>;
    })}</div>;
  }
  return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page"><div className="customer-heading"><div><p className="eyebrow">Make room for your day</p><h1>Your <em>visits.</em></h1><p data-testid="customer-identity">Signed in as {session.user.email||'a verified customer'}.</p></div><form method="post" action="/auth/sign-out"><button className="button button-secondary" type="submit">Sign out</button></form></div>
    {adminRole.data===true&&<p><Link className="button" href="/admin">Open administration</Link></p>}
    {params.message==='signout-failed'&&<p className="auth-notice" role="status">Sign-out could not reach the authentication service. Your session may still be active; please retry.</p>}
    <p className="signin-note">All times are Lagos time (WAT). Demo workspace. Test payments only.</p>
    {error?<p className="auth-notice" role="status">Your visits could not be loaded. Please refresh and retry.</p>:!visits.length?<div className="empty-state"><span aria-hidden="true">↗</span><h2>Your next good workday awaits.</h2><p>No visits yet. Choose a space and make a little room in your day.</p><Link className="button" href="/#plan">Find your space</Link></div>:<>{payments.error&&<p className="auth-notice" role="status">Payment details could not be loaded. Refresh to verify paid and refunded amounts.</p>}<h2 className="visit-group-title">Upcoming <span>{upcoming.length}</span></h2>{upcoming.length?cards(upcoming):<div className="empty-state"><h3>A little room in your calendar.</h3><p>No upcoming visits. <Link href="/#plan">Plan your next one.</Link></p></div>}<h2 className="visit-group-title">History & cancelled visits <span>{history.length}</span></h2>{history.length?cards(history):<p>Past and cancelled visits will appear here.</p>}</>}
    <Link className="button" href="/#plan">Plan another visit ↗</Link></main><SiteFooter/></>;
}
