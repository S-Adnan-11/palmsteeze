import { cookies } from 'next/headers';
import { sessionClient } from '@/lib/supabase/server';
import { authCookieOptions,oauthDestinationCookie } from '@/lib/auth/config';
import { safeDestination } from '@/lib/auth/destinations';
import { authRedirect } from '@/lib/auth/responses';

export async function GET(request:Request) {
  const params = new URL(request.url).searchParams;const store = await cookies();
  const saved = store.get(oauthDestinationCookie)?.value;
  const next = saved ? safeDestination(saved) : '/account';
  store.set(oauthDestinationCookie,'',{...authCookieOptions(),maxAge:0});
  const recover = (message:string) => authRedirect(`/login?message=${message}&next=${encodeURIComponent(next || '/account')}`);
  // No callback-provided destination, identity or error text is trusted/reflected.
  if (!next || params.has('next')) return recover('invalid-callback');
  if (params.has('error')) return recover('cancelled');
  const code = params.get('code');
  if (!code || code.length > 4096 || params.getAll('code').length !== 1) return recover('invalid-callback');
  try {
    const client = await sessionClient(true);if (!client) return recover('unavailable');
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error) return recover('invalid-callback');
    const {data,error} = await client.auth.getUser();
    if (error || !data.user) return recover('session-ended');
    return authRedirect(next);
  } catch {return recover('invalid-callback');}
}
