import { publicClient } from '@/lib/supabase/server';
import { databaseError,jsonError } from '@/lib/http';
import { uuidPattern } from '@/lib/domain';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get('resource'); const start = url.searchParams.get('start'); const end = url.searchParams.get('end');
  if (!resource || !uuidPattern.test(resource) || !start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return jsonError('Choose a valid space and time.',400);
  try {
    const client = publicClient();
    if (!client) return jsonError('Live quotes are not connected.',503);
    const {data,error} = await client.rpc('quote_resource',{p_resource:resource,p_start:start,p_end:end});
    return error ? databaseError(error.code) : Response.json({source:'live',quote:data});
  } catch { return jsonError('Quote could not be checked. Please try again.',503); }
}
