import { authenticatedClient } from '@/lib/supabase/server';
import { recoverBooking } from '@/lib/payments';
export const maxDuration = 60;
import { sameOrigin,jsonError } from '@/lib/http';
import { exactObject,uuidPattern } from '@/lib/domain';
export async function POST(request:Request) {
  if(!sameOrigin(request)) return jsonError('Same-origin request required.',403);
  try {
    const client=await authenticatedClient(request);if(!client) return jsonError('Sign in required.',401);
    const admin=await client.rpc('is_admin');if(admin.error||admin.data!==true) return jsonError('Administrator required.',403);
    let body:Record<string,string>;
    try {const value:unknown=await request.json();exactObject(value,['bookingId']);body=value;if(!uuidPattern.test(body.bookingId)) throw new Error();}
    catch{return jsonError('Valid booking ID required.',400);}
    const booking=await client.from('bookings').select('id').eq('id',body.bookingId).maybeSingle();
    if(booking.error||!booking.data) return jsonError('Booking unavailable.',404);
    const queued=await client.rpc('admin_queue_recovery',{p_booking:body.bookingId,p_reason:'Administrator requested provider verification'});
    if(queued.error) return jsonError(queued.error.code==='22023' ? queued.error.message:'Recovery unavailable.',queued.error.code==='22023' ? 400:503);
    return await recoverBooking(body.bookingId) ? Response.json({recoveryRequested:true}):jsonError('Recovery deferred; durable retries remain queued.',503);
  } catch {return jsonError('Recovery temporarily unavailable.',503);}
}
