import {requestAppOrigin} from '@/lib/deployment';
import {cookies} from 'next/headers';
import {sessionClient,publicConfiguration} from '@/lib/supabase/server';
import {authCookieOptions,authSameOrigin,oauthDestinationCookie,privateHeaders} from '@/lib/auth/config';
import {safeDestination} from '@/lib/auth/destinations';
import {authRedirect} from '@/lib/auth/responses';

export async function POST(request:Request) {
  const origin=requestAppOrigin(request,process.env);
  if(!authSameOrigin(request)) return new Response('Same-origin request required.',{status:403,headers:privateHeaders()});
  const enhanced=request.headers.get('Accept')==='application/json';
  const form=await request.formData().catch(()=>null);
  const next=safeDestination(form?.get('next')||'/account');
  const recover=(message:'invalid-destination'|'unavailable')=>enhanced
    ?Response.json({error:message==='unavailable'?'Google sign-in could not be started. Check your connection and try again.':'That return destination is not allowed. Reload this page to sign in safely.'},{status:message==='unavailable'?503:400,headers:privateHeaders()})
    :authRedirect('/login?message='+message+(next?'&next='+encodeURIComponent(next):''),origin);
  if(!next||form?.getAll('next').length!==1) return recover('invalid-destination');
  try {
    const config=publicConfiguration();if(!config) return recover('unavailable');
    const response=await fetch(config.url+'/auth/v1/settings',{headers:{apikey:config.key},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok||(await response.json()).external?.google!==true) return recover('unavailable');
    const client=await sessionClient(true);if(!client) return recover('unavailable');
    const store=await cookies();store.set(oauthDestinationCookie,next,{...authCookieOptions(origin),maxAge:600});
    const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:origin+'/auth/callback',skipBrowserRedirect:true,scopes:'openid email profile'}});
    if(error||!data.url) return recover('unavailable');
    const url=new URL(data.url);
    // Only the selected Supabase Google endpoint can be returned, in either mode.
    if(url.origin!==process.env.NEXT_PUBLIC_SUPABASE_URL||url.pathname!=='/auth/v1/authorize'||url.searchParams.get('provider')!=='google') return recover('unavailable');
    return enhanced?Response.json({url:url.toString()},{headers:privateHeaders()}):new Response(null,{status:303,headers:privateHeaders(new Headers({Location:url.toString()}))});
  } catch {return recover('unavailable');}
}
