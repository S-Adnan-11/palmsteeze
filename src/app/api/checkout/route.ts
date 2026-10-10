import { authenticatedContext } from '@/lib/supabase/server';
import { customerBooking } from '@/lib/payments';
import { sameOrigin,databaseError,jsonError } from '@/lib/http';
import { exactObject,uuidPattern } from '@/lib/domain';
import { reservationVerification } from '@/lib/turnstile';
import {reservationCapability} from '@/lib/reservation-capability';
export const maxDuration = 60;
export async function POST(request:Request) {
  if(!sameOrigin(request)) return jsonError('Same-origin request required.',403);
  try {
    const session=await authenticatedContext(request);if(!session) return jsonError('Sign in before checkout.',401);
    const {client,user}=session;
    let body:Record<string,string>;let expected:Record<string,number>;
    try {
      const input:unknown=await request.json();const requestKeys=['resourceId','startsAt','endsAt','requestId','expectedQuote'];
      if(input&&typeof input==='object'&&Object.hasOwn(input,'amountKobo')) requestKeys.push('amountKobo');
      exactObject(input,requestKeys);body=input;
      if(body.amountKobo!==undefined&&(!/^\d+$/.test(body.amountKobo)||!Number.isSafeInteger(Number(body.amountKobo)))) throw new Error();
      if(!uuidPattern.test(body.resourceId)||!uuidPattern.test(body.requestId)||!Number.isFinite(Date.parse(body.startsAt))||!Number.isFinite(Date.parse(body.endsAt))) throw new Error();
      expected=JSON.parse(body.expectedQuote);
      const keys=['hourly_kobo','total_kobo','deposit_percent','deposit_kobo','balance_kobo'];
      if(!expected||Array.isArray(expected)||Object.keys(expected).length!==keys.length||keys.some(k=>!Number.isSafeInteger(expected[k]))) throw new Error();
    } catch {return jsonError('Provide a valid selection, request ID and reviewed quote.',400);}
    const verification=await reservationVerification(request);if(verification) return verification;
    const amount=body.amountKobo!==undefined?Number(body.amountKobo):null;
    const capability=reservationCapability({userId:user.id,operation:'checkout',resourceId:body.resourceId,startsAt:body.startsAt,endsAt:body.endsAt,requestId:body.requestId,expectedQuote:expected,amountKobo:amount},process.env);
    const result=await client.rpc('begin_verified_checkout',{p_resource:body.resourceId,p_start:body.startsAt,p_end:body.endsAt,p_request:body.requestId,p_expected:expected,p_amount:amount,p_capability:capability});
    if(result.error) return result.error.code==='P0001' ? jsonError('The quote changed. Review the new price before checkout.',409):databaseError(result.error.code);
    const detail=await customerBooking(client,result.data.booking.id);
    return Response.json(detail,{status:detail?.payment?.state==='creating' ? 202:201});
  } catch {return jsonError('Checkout needs reconciliation. Open your visits before trying a new selection.',503);}
}
