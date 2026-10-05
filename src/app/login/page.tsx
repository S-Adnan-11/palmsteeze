import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { safeDestination } from '@/lib/auth/destinations';
import { SiteHeader } from '@/components/site-header';
export const dynamic = 'force-dynamic';
const messages:Record<string,string> = {
  cancelled:'Sign-in was cancelled. Your visit selection is saved; you can try again or keep browsing.',
  'invalid-callback':'Sign-in was cancelled or this link is incomplete, expired or already used. Start a fresh Google sign-in below.',
  'session-ended':'Your session ended. Sign in again to continue; no new reservation was created.',
  'invalid-destination':'That return destination is not allowed. You can sign in safely to your visits.',
  unavailable:'Google sign-in could not be started. Please retry after the provider is configured.',
  'signed-out':'You are signed out of this browser. You can keep browsing without an account.',
};
export default async function Login({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;const next = safeDestination(params.next || '/account');
  const session = await customerSession();if (session && next) redirect(next);
  const message = !next ? messages['invalid-destination'] : typeof params.message === 'string' ? messages[params.message] : undefined;
  return <><SiteHeader/><main id="main" className="customer-page"><p className="eyebrow">Your space, saved for you</p><h1>Welcome to <em>PalmSteeze.</em></h1>
    <p>Browse freely. Sign in with Google before creating a temporary hold or viewing your visits.</p>
    {message && <p className="auth-notice" role="status">{message}</p>}
    <form action="/auth/sign-in" method="post"><input type="hidden" name="next" value={next || '/account'}/><button className="button" type="submit">Continue with Google <span aria-hidden="true">↗</span></button></form>
    <p className="signin-note">Google shares your basic profile and email. New accounts receive ordinary customer access. No payment is collected.</p>
    <Link href="/">Keep browsing</Link></main></>;
}
