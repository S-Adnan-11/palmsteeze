import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { safeDestination,visitSelection,editVisitDestination } from '@/lib/auth/destinations';
import {GoogleSignIn} from '@/components/google-sign-in';
import {getCatalog} from '@/lib/catalog';
import { SiteHeader } from '@/components/site-header';
import Image from 'next/image';
import {SiteFooter} from '@/components/brand';
import {formatVisitDate} from '@/lib/visit-dates';
export const dynamic = 'force-dynamic';
const messages:Record<string,string> = {
  'booking-required':'Sign in with Google to review your visit.',
  cancelled:'Sign-in cancelled. Try again or keep browsing.',
  'invalid-callback':'This sign-in link expired or is incomplete. Sign in again.',
  'session-ended':'Your session ended. Sign in again.',
  'invalid-destination':'This return link is invalid. Sign in to view your visits.',
  unavailable:'Sign-in could not start. Check your connection and retry.',
  'signed-out':'You are signed out.',
};
export default async function Login({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;const next = safeDestination(params.next || '/account');
  const session = await customerSession();if (session && next) redirect(next);
  const selection=next?.startsWith('/booking/review?')?visitSelection(new URL(next,'https://application.invalid').searchParams):null;
  const catalog=selection?await getCatalog():null;
  const resource=catalog?.resources.find(r=>r.id===selection?.resource);
  const back=selection?editVisitDestination(selection):'/';
  const message = !next ? messages['invalid-destination'] : params.message==='booking-required'&&selection?undefined:params.message==='cancelled'&&!selection?'Sign-in cancelled. Try again or keep browsing.':typeof params.message === 'string' ? messages[params.message] : undefined;
  return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page login-page"><aside className="login-brand"><Image src="/brand/v2/secondary-stacked-forest.svg" width={230} height={250} alt="PalmSteeze upright workspace logo"/><h2>A little space.<br/><em>A fresh perspective.</em></h2><p>Room to focus. Space to connect.</p></aside><section className="login-content"><h1>Welcome to <em>PalmSteeze.</em></h1>
    {/* <p>Sign in to book a visit.</p> */}
    {message && <p className="auth-notice" role="status">{message}</p>}
    {selection&&<div className="signin-selection"><p className="eyebrow">Your selection</p><strong>{resource?.name||'Your selected workspace'}</strong><p>{formatVisitDate(selection.date)} · {String(selection.hour).padStart(2,'0')}:00–{String(selection.hour+selection.duration).padStart(2,'0')}:00 WAT · {selection.duration} {selection.duration===1?'hour':'hours'}</p><Link href={back}>Edit space, date or hours ↗</Link><p className="field-help">No space reserved yet.</p></div>}
    <GoogleSignIn next={next || '/account'}/>
    </section></main><SiteFooter/></>;
}
