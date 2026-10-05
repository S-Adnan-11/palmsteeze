import { authenticatedClient } from '@/lib/supabase/server';
import { sameOrigin,jsonError } from '@/lib/http';
import { uuidPattern,parseNaira } from '@/lib/domain';
export async function POST(request:Request) {
 if(!sameOrigin(request)) return jsonError('Same-origin request required.',403);
 try {
  const client=await authenticatedClient(request);if(!client) return jsonError('Administrator sign-in required.',401);
  const role=await client.rpc('is_admin');if(role.error||role.data!==true) return jsonError('Assigned administrator required.',403);
  let body:Record<string,unknown>;let rpc:string;let args:Record<string,unknown>;
  try {
   const value:unknown=await request.json();if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error();body=value as Record<string,unknown>;
   const exact=(keys:string[])=>{if(Object.keys(body).length!==keys.length||keys.some(key=>!Object.hasOwn(body,key))) throw new Error();};
   const id=(name:string)=>{if(typeof body[name]!=='string'||!uuidPattern.test(body[name] as string)) throw new Error();return body[name];};
   const reason=body.reason;if(typeof reason!=='string'||!reason.trim()||reason.length>512) throw new Error();
   switch(body.operation) {
    case 'decide': exact(['operation','requestId','approve','reason']);if(typeof body.approve!=='boolean') throw new Error();rpc='admin_decide_cancellation';args={p_request:id('requestId'),p_approve:body.approve,p_reason:reason};break;
    case 'recover': exact(['operation','bookingId','reason']);rpc='admin_queue_recovery';args={p_booking:id('bookingId'),p_reason:reason};break;
    case 'resource': exact(['operation','resourceId','name','description','active','reason']);if(typeof body.name!=='string'||typeof body.description!=='string'||typeof body.active!=='boolean') throw new Error();rpc='admin_update_resource';args={p_resource:id('resourceId'),p_name:body.name,p_description:body.description,p_active:body.active,p_reason:reason};break;
    case 'rate': {const naira=Object.hasOwn(body,'hourlyNaira');exact(['operation','resourceId','effectiveAt',naira ? 'hourlyNaira':'hourlyKobo','reason']);if(typeof body.effectiveAt!=='string'||!Number.isFinite(Date.parse(body.effectiveAt))) throw new Error();
     if(naira&&typeof body.hourlyNaira!=='string') throw new Error();const amount=naira ? parseNaira(body.hourlyNaira as string):body.hourlyKobo;
     if(!Number.isSafeInteger(amount)) throw new Error();rpc='admin_schedule_rate';args={p_resource:id('resourceId'),p_effective:body.effectiveAt,p_hourly:amount,p_reason:reason};break;}
    case 'hours': exact(['operation','opensHour','closesHour','reason']);if(!Number.isInteger(body.opensHour)||!Number.isInteger(body.closesHour)) throw new Error();rpc='admin_update_hours';args={p_open:body.opensHour,p_close:body.closesHour,p_reason:reason};break;
    case 'closure': exact(['operation','resourceId','startsAt','endsAt','reason','requestId']);if(typeof body.startsAt!=='string'||typeof body.endsAt!=='string'||!Number.isFinite(Date.parse(body.startsAt))||!Number.isFinite(Date.parse(body.endsAt))) throw new Error();rpc='admin_create_closure';args={p_resource:id('resourceId'),p_start:body.startsAt,p_end:body.endsAt,p_reason:reason,p_request:id('requestId')};break;
    case 'removeClosure': exact(['operation','closureId','reason']);rpc='admin_remove_closure';args={p_closure:id('closureId'),p_reason:reason};break;
    default: throw new Error();
   }
  } catch {return jsonError('Provide the required administration fields and a reason.',400);}
  const result=await client.rpc(rpc,args);
  if(result.error) {
   if(result.error.code==='23P01') {
    let affected:unknown[]=[];try{const parsed=JSON.parse(result.error.details||'[]');if(Array.isArray(parsed)) affected=parsed;}catch{/* Keep malformed provider details private. */}
    return Response.json({error:'Active allocations conflict with this change. Resolve the listed bookings or closures explicitly.',affected},{status:409});
   }
   if(result.error.code==='42501') return jsonError('Assigned administrator required.',403);
   if(result.error.code==='22023') return jsonError(result.error.message,400);
   if(result.error.code==='23505') return jsonError('A conflicting operation already exists.',409);
   return jsonError('Administration is temporarily unavailable; retry safely.',503);
  }
  // Durable work is committed. The operational schedule performs refunds;
  // this request never depends on the provider being available for its success.
  return Response.json({saved:true,id:result.data});
 } catch {return jsonError('Administration is temporarily unavailable.',503);}
}
