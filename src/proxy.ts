import { createServerClient,type CookieOptions } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
import { publicConfiguration } from '@/lib/supabase/server';
import { authCookieOptions,privateHeaders } from '@/lib/auth/config';
import {requestAppOrigin} from '@/lib/deployment';
import {clearanceCookie,validClearance} from '@/lib/security-sessions';
import {entranceDestination,entranceExempt,publicAsset} from '@/lib/entrance';
import {searchEnabled,searchablePaths} from '@/lib/search';

export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  if(publicAsset(path)) {
    const response=NextResponse.next();
    if(!searchEnabled(process.env))response.headers.set('X-Robots-Tag','noindex, nofollow');
    return response;
  }
  const headers=(response:NextResponse)=>{
    privateHeaders(response.headers);
    if(!searchEnabled(process.env)||request.nextUrl.search||!searchablePaths.some(value=>value===path))response.headers.set('X-Robots-Tag','noindex, nofollow');
    return response;
  };
  let origin:string;
  try {origin=requestAppOrigin(request,process.env);}
  catch {
    const response=new NextResponse('Unknown or conflicting application origin.',{status:403,headers:privateHeaders()});
    response.headers.set('X-Robots-Tag','noindex, nofollow');return response;
  }
  if(!entranceExempt(path)&&!validClearance(request.cookies.get(clearanceCookie)?.value,process.env,Date.now(),origin)) {
    if(path.startsWith('/api/')||!['GET','HEAD'].includes(request.method)) {
      const response=NextResponse.json({error:'Entrance verification is required or has expired. Verify again, then retry your request.',entranceRequired:true,verificationPath:'/verify'},{status:403});
      return headers(response);
    }
    const destination=entranceDestination(path+request.nextUrl.search);
    // Unknown routes must reach Next's real 404 rather than a successful gate page.
    if(!destination)return headers(NextResponse.next());
    const url=new URL('/verify',origin);url.searchParams.set('next',destination);
    // The root renders the public entrance itself, without issuing clearance.
    if(path==='/') {
      return headers(NextResponse.next());
    }
    return headers(NextResponse.redirect(url,307));
  }
  if(entranceExempt(path)) return headers(NextResponse.next());
  let response = NextResponse.next({request});
  // Public demonstrations are fully synthetic and do not refresh or inspect Auth.
  if (request.nextUrl.pathname === '/preview/admin' || request.nextUrl.pathname === '/portfolio') {
    return headers(response);
  }
  // Never accept a user/role header as identity; pages/routes verify with Auth themselves.
  let config:ReturnType<typeof publicConfiguration>;
  try {config = publicConfiguration();} catch {return headers(response);}
  if (config && request.cookies.getAll().some((c) => c.name.startsWith('sb-'))) {
    const pendingCookies = new Map<string,{value:string;options:CookieOptions}>();
    const client = createServerClient(config.url,config.key,{cookieOptions:authCookieOptions(origin),global:{fetch:(input,init) => fetch(input,{...init,cache:'no-store'})},cookies:{
      getAll:() => request.cookies.getAll(),
      setAll:(items,headers) => {
        items.forEach(({name,value}) => request.cookies.set(name,value));
        items.forEach(({name,value,options}) => pendingCookies.set(name,{value,options}));
        response = NextResponse.next({request});
        pendingCookies.forEach(({value,options},name) => response.cookies.set(name,value,{...options,...authCookieOptions(origin)}));
        Object.entries(headers).forEach(([name,value]) => response.headers.set(name,value));
      },
    }});
    // This verifies with the Auth server and refreshes expired access tokens using the cookie refresh token.
    await client.auth.getUser().catch(() => null);
  }
  return headers(response);
}
export const config = {matcher:['/:path*']};
