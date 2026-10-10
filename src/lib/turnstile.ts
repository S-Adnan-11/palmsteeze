import 'server-only';
import { verifyReservationToken } from './turnstile-verification';
export async function reservationVerification(request:Request) {
  const result=await verifyReservationToken(request.headers.get('X-Turnstile-Token'),process.env);
  return result.ok?null:Response.json({error:result.error,securityCheck:true},{status:result.status});
}
