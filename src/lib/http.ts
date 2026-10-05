import 'server-only';
export function jsonError(message: string, status: number) { return Response.json({error:message},{status}); }
export function sameOrigin(request: Request) {
  // Next may normalize request.url to localhost internally; Host retains the incoming authority.
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  try { return request.headers.get('origin') === new URL(`${url.protocol}//${host}`).origin; }
  catch { return false; }
}
export function databaseError(code?: string) {
  if (code === '23P01') return jsonError('That space was just taken or blocked. Choose another space or time.',409);
  if (code === '23505') return jsonError('You already have an unresolved visit. Open Your visits to resume or safely stop checkout before starting another.',409);
  if (code === '42501') return jsonError('You do not have permission for this operation.',403);
  if (code === '22023') return jsonError('Choose a valid space and whole hours within opening hours and the booking horizon.',400);
  return jsonError('The workspace service is unavailable. Please try again.',503);
}
