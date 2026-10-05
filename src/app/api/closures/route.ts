import { authenticatedClient } from '@/lib/supabase/server';
import { databaseError,jsonError,sameOrigin } from '@/lib/http';
import { exactObject,uuidPattern } from '@/lib/domain';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError('Same-origin request required.',403);
  try {
    const client = await authenticatedClient(request);
    if (!client) return jsonError('Administrator sign-in required.',401);
    let body: Record<string,string>;
    try {
      const value: unknown = await request.json(); exactObject(value,['resourceId','startsAt','endsAt','reason']); body = value;
      if (!uuidPattern.test(body.resourceId) || !Number.isFinite(Date.parse(body.startsAt)) || !Number.isFinite(Date.parse(body.endsAt))
          || !body.reason.trim() || body.reason.length > 512) throw new Error();
    } catch { return jsonError('Provide a valid resource, interval and reason.',400); }
    const {data,error} = await client.rpc('create_closure',{p_resource:body.resourceId,p_start:body.startsAt,p_end:body.endsAt,p_reason:body.reason});
    return error ? databaseError(error.code) : Response.json({allocationId:data},{status:201});
  } catch { return jsonError('Closure could not be created.',503); }
}
