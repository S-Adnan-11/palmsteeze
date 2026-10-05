import { authenticatedClient } from '@/lib/supabase/server';
import { exactObject,uuidPattern } from '@/lib/domain';
import { sameOrigin,jsonError,databaseError } from '@/lib/http';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!sameOrigin(request)) return jsonError('Same-origin request required.',403);
 try {
  const client=await authenticatedClient(request);if(!client) return jsonError('Sign in required.',401);
  const {id}=await params;if(!uuidPattern.test(id)) return jsonError('Booking unavailable.',404);
  let body:Record<string,string>;
  try {const value:unknown=await request.json();exactObject(value,['reason']);body=value;if(body.reason.trim().length<1||body.reason.trim().length>512) throw new Error();}
  catch{return jsonError('Provide a reason of 1–512 characters.',400);}
  const result=await client.rpc('request_cancellation',{p_booking:id,p_reason:body.reason});
  return result.error ? databaseError(result.error.code):Response.json({request:result.data},{status:201});
 }catch{return jsonError('Cancellation request unavailable. Retry safely; your confirmed booking stays allocated.',503);}
}
