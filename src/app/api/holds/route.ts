import {requestAppOrigin} from '@/lib/deployment';
import { authenticatedClient,authenticatedContext } from '@/lib/supabase/server';
import { databaseError,jsonError,sameOrigin } from '@/lib/http';
import { exactObject,uuidPattern } from '@/lib/domain';
import { reservationVerification } from '@/lib/turnstile';
import {reservationCapability} from '@/lib/reservation-capability';
export async function GET(request: Request) {
  try {
    const client = await authenticatedClient(request);
    if (!client) return jsonError('Sign in to view your holds.',401);
    const {data,error} = await client.from('bookings').select('*').order('created_at',{ascending:false});
    return error ? databaseError(error.code) : Response.json({bookings:data});
  } catch { return jsonError('Holds could not be loaded.',503); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError('Same-origin request required.',403);
  try {
    const session = await authenticatedContext(request);
    if (!session) return jsonError('Sign in to create a temporary hold.',401);
    const {client,user}=session;
    let body: Record<string,string>;
    try {
      const value: unknown = await request.json();
      exactObject(value,['resourceId','startsAt','endsAt','requestId']); body = value;
      if (!uuidPattern.test(body.resourceId) || !uuidPattern.test(body.requestId)
          || !Number.isFinite(Date.parse(body.startsAt)) || !Number.isFinite(Date.parse(body.endsAt))) throw new Error();
    } catch { return jsonError('Provide only a valid resource, interval and request ID.',400); }
    const verification=await reservationVerification(request);if(verification) return verification;
    const capability=reservationCapability({resourceId:body.resourceId,startsAt:body.startsAt,endsAt:body.endsAt,requestId:body.requestId,userId:user.id,operation:'hold',amountKobo:null,expectedQuote:null},process.env,Date.now(),requestAppOrigin(request,process.env));
    const {data,error} = await client.rpc('create_verified_hold',{p_resource:body.resourceId,p_start:body.startsAt,p_end:body.endsAt,p_request:body.requestId,p_capability:capability});
    return error ? databaseError(error.code) : Response.json({booking:data},{status:201});
  } catch { return jsonError('Hold could not be created. Please retry safely with the same request ID.',503); }
}
