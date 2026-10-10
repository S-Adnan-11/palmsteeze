import { configuredAppOrigin } from './deployment';

type Environment = Record<string,string|undefined>;
export const reservationAction = 'reserve';
export const entranceAction = 'entrance';
export type TurnstileAction = typeof reservationAction|typeof entranceAction;
export function isTurnstileTestKey(value:string) { return /^[123]x0{10,}/.test(value); }
export function turnstileConfiguration(env:Environment) {
  const hostname = new URL(configuredAppOrigin(env)).hostname;
  const local = ['localhost','127.0.0.1'].includes(hostname) && !env.VERCEL_ENV && env.VERCEL !== '1';
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const secret = env.TURNSTILE_SECRET_KEY || '';
  const testing = env.PALMSTEEZE_TURNSTILE_TEST_MODE === 'true';
  if (!siteKey || !secret || /your_|placeholder/i.test(siteKey+secret)) throw new Error('Reservation verification is not configured.');
  if ((testing && !local) || ((isTurnstileTestKey(siteKey)||isTurnstileTestKey(secret)) && (!testing || !local))) {
    throw new Error('Turnstile testing is restricted to an explicitly configured loopback test process.');
  }
  if (testing && (!isTurnstileTestKey(siteKey)||!isTurnstileTestKey(secret))) throw new Error('Use official test keys together.');
  return {hostname,siteKey,secret,testing};
}
