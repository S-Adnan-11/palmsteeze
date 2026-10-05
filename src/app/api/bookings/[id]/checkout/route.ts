import { authenticatedClient } from '@/lib/supabase/server';
import { customerBooking } from '@/lib/payments';
export const maxDuration = 60;
import { jsonError,sameOrigin,databaseError } from '@/lib/http';
import { uuidPattern } from '@/lib/domain';
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}) {
  if(!sameOrigin(request)) return jsonError('Same-origin request required.',403);
  try {
    const client=await authenticatedClient(request);if(!client) return jsonError('Sign in to stop checkout.',401);
    const {id}=await params;if(!uuidPattern.test(id)) return jsonError('Checkout unavailable.',404);
    const result=await client.rpc('request_checkout_cancel',{p_booking:id});
    if(result.error) return databaseError(result.error.code);
    const detail=await customerBooking(client,id);
    return detail ? Response.json(detail):jsonError('Checkout unavailable.',404);
  } catch {return jsonError('Checkout cancellation is being reconciled. Inventory remains protected until Stripe confirms its outcome.',503);}
}
