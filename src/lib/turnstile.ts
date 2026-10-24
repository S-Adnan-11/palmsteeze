import 'server-only';
import { verifyReservationToken } from './turnstile-verification';
import {requestAppOrigin} from './deployment';
export async function reservationVerification(request:Request) {
  const result=await verifyReservationToken(request.headers.get('X-Turnstile-Token'),process.env,fetch,Date.now(),requestAppOrigin(request,process.env));
  return result.ok?null:Response.json({error:result.error,securityCheck:true},{status:result.status});
}
