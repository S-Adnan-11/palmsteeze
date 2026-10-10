import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {customerSession} from '@/lib/supabase/server';
import {customerBooking,hostedCheckoutURL} from '@/lib/payments';
import {uuidPattern} from '@/lib/domain';
import {accountProfile} from '@/lib/account-profile';
import {SandboxCard} from '@/components/sandbox-card';

export const dynamic='force-dynamic';export const revalidate=0;
export default async function TestCardCompanion({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!uuidPattern.test(id)||process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED!=='true')notFound();
  const session=await customerSession();
  if(!session)redirect(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);
  const detail=await customerBooking(session.client,id,false);
  if(!detail)notFound();
  const open=detail.payment?.state==='open'&&!detail.payment.cancel_requested&&hostedCheckoutURL(detail.payment.checkout_url);
  return <main id="main" className="sandbox-companion" tabIndex={-1}><h1>Test payment <em>companion.</em></h1>
    {open?<SandboxCard bookingId={id} createdAt={detail.booking.created_at} displayName={accountProfile(session.user).name} companion/>:<p>This checkout is no longer open.</p>}
    <Link className="text-link" href={`/booking/${id}`}>Back to your booking</Link>
  </main>;
}
