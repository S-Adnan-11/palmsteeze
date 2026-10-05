import { authenticatedClient } from '@/lib/supabase/server';
import { customerBooking } from '@/lib/payments';
export const maxDuration = 60;
import { jsonError } from '@/lib/http';
import { uuidPattern } from '@/lib/domain';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const client=await authenticatedClient(request);if(!client) return jsonError('Sign in to view your booking.',401);
    const {id}=await params;if(!uuidPattern.test(id)) return jsonError('Booking unavailable.',404);
    const detail=await customerBooking(client,id);
    return detail ? Response.json(detail):jsonError('Booking unavailable.',404);
  } catch {return jsonError('Booking status could not be verified. Your allocation is protected while payment is uncertain.',503);}
}
