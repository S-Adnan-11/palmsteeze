import {getCatalog} from '@/lib/catalog';
import {publicClient} from '@/lib/supabase/server';
import {jsonError} from '@/lib/http';
import {uuidPattern,intervalFromSelection} from '@/lib/domain';
import {eligibleHours} from '@/lib/booking-options';
export const dynamic='force-dynamic';

export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  const resource=params.get('resource')||'';const date=params.get('date')||'';
  if([...params.keys()].length!==2||params.getAll('resource').length!==1||params.getAll('date').length!==1||!uuidPattern.test(resource)||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError('Choose a valid space and date.',400);
  try {
    const [catalog,client]=await Promise.all([getCatalog(),Promise.resolve(publicClient())]);
    if(catalog.source!=='live'||!client) return jsonError('Available times could not be loaded. Retry without changing your selection.',503);
    if(!catalog.resources.some(r=>r.id===resource)) return jsonError('This space is no longer offered. Choose another space.',400);
    const hours=eligibleHours(date,catalog.settings);
    // Bounded to the venue's opening hours. Existing public RPC exposes only
    // availability booleans; no allocation, booking or identity records leave it.
    const slots=await Promise.all(hours.map(async hour=>{
      const interval=intervalFromSelection(date,hour,1);
      const {data,error}=await client.rpc('resource_availability',{p_start:interval.starts_at,p_end:interval.ends_at});
      if(error) throw new Error('Availability read failed.');
      return {hour,available:data.some((r:{resource_id:string;available:boolean})=>r.resource_id===resource&&r.available===true)};
    }));
    return Response.json({source:'live',slots,checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
  } catch {return jsonError('Available times could not be loaded. Retry without changing your selection.',503);}
}
