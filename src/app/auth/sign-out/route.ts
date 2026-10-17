import {requestAppOrigin} from '@/lib/deployment';
import { cookies } from 'next/headers';
import { sessionClient } from '@/lib/supabase/server';
import { authCookieOptions,authSameOrigin,oauthDestinationCookie,privateHeaders } from '@/lib/auth/config';
import { authRedirect } from '@/lib/auth/responses';

export async function POST(request:Request) {
  const origin=requestAppOrigin(request,process.env);
  if (!authSameOrigin(request)) return new Response('Same-origin request required.',{status:403,headers:privateHeaders()});
  const client = await sessionClient(true);
  const result = client ? await client.auth.signOut({scope:'local'}).catch(() => ({error:true})) : {error:null};
  if (result.error) return authRedirect('/account?message=signout-failed',origin);
  const store = await cookies();
  for (const cookie of store.getAll()) if (cookie.name.startsWith('sb-') || cookie.name === oauthDestinationCookie) {
    store.set(cookie.name,'',{...authCookieOptions(origin),maxAge:0});
  }
  return authRedirect('/login?message=signed-out',origin);
}
