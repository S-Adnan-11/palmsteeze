import {requestAppOrigin} from '@/lib/deployment';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {authSameOrigin,privateHeaders} from '@/lib/auth/config';
import {createPreference,preferenceCookie,preferenceSeconds,readPreference,securityCookieOptions} from '@/lib/security-sessions';
export async function GET(request:Request) {
  const origin=requestAppOrigin(request,process.env);
  const preference=readPreference((await cookies()).get(preferenceCookie)?.value,process.env,Date.now(),origin);
  const response=NextResponse.json({preference});privateHeaders(response.headers);return response;
}
export async function POST(request:Request) {
  const origin=requestAppOrigin(request,process.env);
  if(!authSameOrigin(request)) return NextResponse.json({error:'Same-origin request required.'},{status:403});
  let optional:boolean;
  try {const body=await request.json();if(!body||Object.keys(body).length!==1||typeof body.optional!=='boolean')throw new Error();optional=body.optional;}
  catch {return NextResponse.json({error:'Choose optional storage or necessary only.'},{status:400});}
  try {
    const response=NextResponse.json({preference:{optional}});
    response.cookies.set(preferenceCookie,createPreference(optional,process.env,Date.now(),origin),securityCookieOptions(process.env,preferenceSeconds,origin));
    privateHeaders(response.headers);return response;
  } catch {return NextResponse.json({error:'Your preference could not be saved. Optional storage stays off; retry your choice.'},{status:503});}
}
