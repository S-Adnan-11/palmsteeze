import 'server-only';

export function appOrigin() {
  const value = process.env.APP_ORIGIN || 'http://localhost:3000';
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid APP_ORIGIN');
  return value;
}
export function authCookieOptions() {
  return {path:'/',httpOnly:true,sameSite:'lax' as const,secure:appOrigin().startsWith('https:')};
}
export const oauthDestinationCookie = 'ps-oauth-next';
export function authSameOrigin(request:Request) {
  return request.headers.get('origin') === appOrigin() && request.headers.get('host') === new URL(appOrigin()).host;
}
export function privateHeaders(headers = new Headers()) {
  headers.set('Cache-Control','private, no-store, no-cache, max-age=0, must-revalidate');
  headers.set('Pragma','no-cache');headers.set('Expires','0');
  const vary = new Set((headers.get('Vary') || '').split(',').map((v) => v.trim()).filter(Boolean));
  vary.add('Cookie');vary.add('Authorization');headers.set('Vary',[...vary].join(', '));
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  return headers;
}
