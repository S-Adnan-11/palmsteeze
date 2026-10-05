import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { SiteHeader } from '@/components/site-header';
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
  return <><SiteHeader/><main id="main" className="customer-page"><p className="eyebrow">Your workday</p><h1>Your <em>visits.</em></h1>
    <p data-testid="customer-identity">Signed in as {session.user.email || 'a verified customer'}.</p>
    {adminRole.data===true&&<p><Link className="button" href="/admin">Open administration</Link></p>}
    {params.message === 'signout-failed' && <p className="auth-notice" role="status">Sign-out could not reach the authentication service. Your session may still be active; please retry.</p>}
    <form method="post" action="/auth/sign-out"><button className="button" type="submit">Sign out</button></form>
    <p className="signin-note">Payment-confirmed visits and unpaid holds appear separately. Times are Lagos time. Sandbox payments only.</p>
    {error ? <p role="status">Your visits could not be loaded. Please refresh and retry.</p> : !data?.length ? <p>No visits yet. <Link href="/#plan">Choose your space and hours.</Link></p>
      : <div className="visit-list">{data.map((booking) => {
        const expired = booking.payment_kind==='legacy' && booking.state === 'held' && Date.parse(booking.expires_at) <= Date.now();
        const payment=states.get(booking.id);
        return <article className="visit-card" key={booking.id} data-booking-id={booking.id}><h2>{names.get(booking.resource_id) || 'Workspace'}</h2>
          <p>{new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}).format(new Date(booking.starts_at))} WAT</p>
          <p>Total quote: {formatMoney(Number(booking.total_kobo))} · {expired ? 'expired' : booking.state}</p>
          <p>Payment: {payment?.state||(booking.payment_kind==='legacy' ? 'legacy unpaid':'unavailable')} · Refund: {payment?.refund_blocked ? 'failed — assistance required':payment?.refund_state||'none'}</p>
          {payment&&<><p>Amount paid: {formatMoney(Number(payment.collected_kobo))} · Refunded: {formatMoney(Number(payment.refunded_kobo))}</p>
          <p>{booking.state==='cancelled' ? `Remaining refundable amount: ${formatMoney(Number(payment.collected_kobo)-Number(payment.refunded_kobo))}`:`Outstanding balance: ${formatMoney(Number(booking.total_kobo)-Number(payment.collected_kobo)+Number(payment.refunded_kobo))}`}</p></>}
          <p><Link href={`/booking/${booking.id}`}>View booking details</Link></p>
          {booking.payment_kind==='legacy' && booking.state === 'held' && !expired && <ReleaseHold id={booking.id}/>}</article>;
      })}</div>}
    <p><Link href="/#plan">Plan another visit</Link></p></main></>;
}
