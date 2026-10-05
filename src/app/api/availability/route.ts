import { publicClient } from '@/lib/supabase/server';
import { databaseError,jsonError } from '@/lib/http';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start'); const end = url.searchParams.get('end');
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return jsonError('Choose a valid date and time.',400);
  try {
    const client = publicClient();
    if (!client) return jsonError('Live availability is not connected. Preview inventory does not indicate availability.',503);
    const {data,error} = await client.rpc('resource_availability',{p_start:start,p_end:end});
    return error ? databaseError(error.code) : Response.json({source:'live',availability:data});
  } catch { return jsonError('Availability could not be checked. Please try again.',503); }
}
