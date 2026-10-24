import 'server-only';
import { configuredAppOrigin,sameAppOrigin,validatedAppOrigin } from '@/lib/deployment';

export function appOrigin() {
  return configuredAppOrigin(process.env);
}
export function authCookieOptions(origin=appOrigin()) {
  return {path:'/',httpOnly:true,sameSite:'lax' as const,secure:validatedAppOrigin(origin,process.env).startsWith('https:')};
}
export const oauthDestinationCookie = 'ps-oauth-next';
export function authSameOrigin(request:Request) {
  return sameAppOrigin(request,process.env);
}
export function privateHeaders(headers = new Headers()) {
  headers.set('Cache-Control','private, no-store, no-cache, max-age=0, must-revalidate');
  headers.set('Pragma','no-cache');headers.set('Expires','0');
  const vary = new Set((headers.get('Vary') || '').split(',').map((v) => v.trim()).filter(Boolean));
  vary.add('Cookie');vary.add('Authorization');headers.set('Vary',[...vary].join(', '));
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  return headers;
}
