import { cookies } from 'next/headers';
import { sessionClient,publicConfiguration } from '@/lib/supabase/server';
import { appOrigin,authCookieOptions,authSameOrigin,oauthDestinationCookie,privateHeaders } from '@/lib/auth/config';
import { safeDestination } from '@/lib/auth/destinations';
import { authRedirect } from '@/lib/auth/responses';

export async function POST(request:Request) {
  if (!authSameOrigin(request)) return new Response('Same-origin request required.',{status:403,headers:privateHeaders()});
  const form = await request.formData().catch(() => null);
  const next = safeDestination(form?.get('next') || '/account');
  if (!next || form?.getAll('next').length !== 1) return authRedirect('/login?message=invalid-destination');
  try {
    const config = publicConfiguration();if (!config) return authRedirect('/login?message=unavailable');
    const response = await fetch(`${config.url}/auth/v1/settings`,{headers:{apikey:config.key},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (!response.ok || (await response.json()).external?.google !== true) return authRedirect(`/login?message=unavailable&next=${encodeURIComponent(next)}`);
  } catch {return authRedirect(`/login?message=unavailable&next=${encodeURIComponent(next)}`);}
  const client = await sessionClient(true);if (!client) return authRedirect('/login?message=unavailable');
  const store = await cookies();
  store.set(oauthDestinationCookie,next,{...authCookieOptions(),maxAge:600});
  const {data,error} = await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${appOrigin()}/auth/callback`,skipBrowserRedirect:true,scopes:'openid email profile'}});
  if (error || !data.url) return authRedirect(`/login?message=unavailable&next=${encodeURIComponent(next)}`);
  const url = new URL(data.url);
  // Only redirect to our selected Supabase Auth endpoint; provider navigation follows there.
  if (url.origin !== process.env.NEXT_PUBLIC_SUPABASE_URL || url.pathname !== '/auth/v1/authorize') return authRedirect('/login?message=unavailable');
  const response = new Response(null,{status:303,headers:privateHeaders(new Headers({Location:url.toString()}))});
  return response;
}
