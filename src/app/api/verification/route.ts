import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {authSameOrigin,privateHeaders} from '@/lib/auth/config';
import {clearanceCookie,clearanceSeconds,createClearance,securityCookieOptions,validClearance} from '@/lib/security-sessions';
import {entranceDestination} from '@/lib/entrance';
import {verifyTurnstileToken} from '@/lib/turnstile-verification';
export async function GET() {
  const store=await cookies();const response=NextResponse.json({verified:validClearance(store.get(clearanceCookie)?.value,process.env)});
  privateHeaders(response.headers);return response;
}
export async function POST(request:Request) {
  if(!authSameOrigin(request)) return NextResponse.json({error:'Open verification on the canonical site address.'},{status:403});
  let next:string;let token:unknown;
  try {
    const body=await request.json();
    if(!body||Object.keys(body).some(key=>!['token','next'].includes(key)))throw new Error();
    const allowed=entranceDestination(body.next);if(!allowed)throw new Error();next=allowed;token=body.token;
  } catch {return NextResponse.json({error:'Choose a valid internal destination and retry verification.'},{status:400});}
  const verified=await verifyTurnstileToken(token,process.env,'entrance');
  if(!verified.ok) return NextResponse.json({error:verified.status===503?'Verification is temporarily unavailable. Check your connection and retry.':'The verification failed or expired. Retry the security check to continue.',securityCheck:true},{status:verified.status});
  try {
    const response=NextResponse.json({verified:true,destination:next});
    response.cookies.set(clearanceCookie,createClearance(process.env),securityCookieOptions(process.env,clearanceSeconds));
    privateHeaders(response.headers);return response;
  } catch {return NextResponse.json({error:'Verification could not create a secure session. Try again later.'},{status:503});}
}
