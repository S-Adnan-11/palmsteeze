import { reservationAction,turnstileConfiguration,type TurnstileAction } from './turnstile-config';

export type Verification = {ok:true}|{ok:false;status:403|503;error:string};
const retry = 'Security verification failed or expired. Retry the security check; your visit choices are saved.';
// Pure boundary for deterministic provider faults. The application wrapper is server-only.
export async function verifyTurnstileToken(token:unknown,env:Record<string,string|undefined>,action:TurnstileAction,fetcher:typeof fetch=fetch,now=Date.now()):Promise<Verification> {
  if (typeof token!=='string'||!token.trim()||token.length>2048) return {ok:false,status:403,error:'Complete the security check before reserving. Your visit choices are saved.'};
  let config:ReturnType<typeof turnstileConfiguration>;
  try { config=turnstileConfiguration(env); }
  catch { return {ok:false,status:503,error:'Reservation security is unavailable. Keep your selection and try again later.'}; }
  try {
    // Do not forward caller-supplied IPs or identities. Siteverify enforces single use.
    // A fresh challenge on retry precedes existing database request-ID deduplication.
    const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},cache:'no-store',
      body:new URLSearchParams({secret:config.secret,response:token}),signal:AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    const result=await response.json();
    if (!result||typeof result!=='object') throw new Error();
    if (result.success!==true) {
      const unavailable=Array.isArray(result['error-codes']) && result['error-codes'].some((code:string)=>['internal-error','missing-input-secret','invalid-input-secret'].includes(code));
      return {ok:false,status:unavailable?503:403,error:unavailable?'Security verification is temporarily unavailable. Retry the security check.':retry};
    }
    // Official dummy responses have synthetic hostname/action metadata. This
    // exception requires explicit loopback test mode and both official keys.
    if (config.testing) return {ok:true};
    const timestamp=typeof result.challenge_ts==='string'?Date.parse(result.challenge_ts):NaN;
    if (result.hostname!==config.hostname||result.action!==action||!Number.isFinite(timestamp)||now-timestamp>300000||timestamp-now>30000) {
      return {ok:false,status:403,error:retry};
    }
    return {ok:true};
  } catch { return {ok:false,status:503,error:'Security verification could not be reached. Retry the security check; your visit choices are saved.'}; }
}
export function verifyReservationToken(token:unknown,env:Record<string,string|undefined>,fetcher:typeof fetch=fetch,now=Date.now()) {
  return verifyTurnstileToken(token,env,reservationAction,fetcher,now);
}
