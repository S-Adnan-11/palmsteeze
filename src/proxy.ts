import { createServerClient,type CookieOptions } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
import { publicConfiguration } from '@/lib/supabase/server';
import { authCookieOptions,privateHeaders } from '@/lib/auth/config';
import {requestAppOrigin} from '@/lib/deployment';
import {clearanceCookie,validClearance} from '@/lib/security-sessions';
import {entranceDestination,entranceExempt,publicAsset} from '@/lib/entrance';

export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  if(publicAsset(path))return NextResponse.next();
  let origin:string;
  try {origin=requestAppOrigin(request,process.env);}
  catch {return new NextResponse('Unknown or conflicting application origin.',{status:403,headers:privateHeaders()});}
  if(!entranceExempt(path)&&!validClearance(request.cookies.get(clearanceCookie)?.value,process.env,Date.now(),origin)) {
    if(path.startsWith('/api/')||!['GET','HEAD'].includes(request.method)) {
      const response=NextResponse.json({error:'Entrance verification is required or has expired. Verify again, then retry your request.',entranceRequired:true,verificationPath:'/verify'},{status:403});
      privateHeaders(response.headers);return response;
    }
    const destination=entranceDestination(path+request.nextUrl.search)||'/';
    const url=new URL('/verify',origin);url.searchParams.set('next',destination);
    // Publish product information at the canonical homepage without issuing
    // clearance or exposing the application behind the entrance challenge.
    if(path==='/') {
      url.searchParams.set('overview','1');
      const response=NextResponse.rewrite(url);privateHeaders(response.headers);return response;
    }
    const response=NextResponse.redirect(url,307);privateHeaders(response.headers);return response;
  }
  if(entranceExempt(path)) return NextResponse.next();
  let response = NextResponse.next({request});
  // Public demonstrations are fully synthetic and do not refresh or inspect Auth.
  if (request.nextUrl.pathname === '/preview/admin' || request.nextUrl.pathname === '/portfolio') {
    privateHeaders(response.headers);return response;
  }
  // Never accept a user/role header as identity; pages/routes verify with Auth themselves.
  let config:ReturnType<typeof publicConfiguration>;
  try {config = publicConfiguration();} catch {privateHeaders(response.headers);return response;}
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
  privateHeaders(response.headers);return response;
}
export const config = {matcher:['/:path*']};
