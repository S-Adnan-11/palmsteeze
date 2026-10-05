import { authenticatedClient } from '@/lib/supabase/server';
import { databaseError,jsonError,sameOrigin } from '@/lib/http';
import { uuidPattern } from '@/lib/domain';
export async function DELETE(request: Request,{params}: {params:Promise<{id:string}>}) {
  if (!sameOrigin(request)) return jsonError('Same-origin request required.',403);
  try {
    const client = await authenticatedClient(request);
    if (!client) return jsonError('Sign in to release your hold.',401);
    const {id} = await params;
    if (!uuidPattern.test(id)) return jsonError('Invalid hold.',400);
    const {error} = await client.rpc('release_hold',{p_booking:id});
    return error ? databaseError(error.code) : new Response(null,{status:204});
  } catch { return jsonError('Hold could not be released. Please try again.',503); }
}
