import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {configuredAppOrigin,validatedAppOrigin} from './deployment';

type Environment = Record<string,string|undefined>;
export const clearanceCookie='ps-clearance';
export const preferenceCookie='ps-preferences';
export const clearanceSeconds=30*60;
export const preferenceSeconds=180*24*60*60;
export function securityKey(env:Environment) {
  const value=env.PALMSTEEZE_SECURITY_SECRET||'';
  if(!/^[a-f0-9]{64}$/.test(value)) throw new Error('Application security is not configured.');
  return value;
}
export function signSecurityPayload(purpose:string,payload:Record<string,unknown>,env:Environment) {
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature=createHmac('sha256',securityKey(env)).update(`palmsteeze-${purpose}-v1.${encoded}`).digest('hex');
  return `${encoded}.${signature}`;
}
function readPayload(value:string|undefined,purpose:string,version:number,lifetime:number,env:Environment,now:number,origin:string) {
  try {
    if(!value||value.length>4096) return null;
    const pieces=value.split('.');if(pieces.length!==2||!/^[a-f0-9]{64}$/.test(pieces[1])) return null;
    const expected=createHmac('sha256',securityKey(env)).update(`palmsteeze-${purpose}-v1.${pieces[0]}`).digest();
    if(!timingSafeEqual(expected,Buffer.from(pieces[1],'hex'))) return null;
    const payload=JSON.parse(Buffer.from(pieces[0],'base64url').toString('utf8'));
    const seconds=Math.floor(now/1000);
    if(payload.v!==version||payload.purpose!==purpose||payload.origin!==validatedAppOrigin(origin,env)
      ||!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||payload.exp-payload.iat!==lifetime
      ||payload.iat>seconds+30||payload.exp<=seconds) return null;
    return payload as Record<string,unknown>;
  } catch {return null;}
}
export function createClearance(env:Environment,now=Date.now(),origin=configuredAppOrigin(env)) {
  const iat=Math.floor(now/1000);
  return signSecurityPayload('clearance',{v:1,purpose:'clearance',origin:validatedAppOrigin(origin,env),iat,exp:iat+clearanceSeconds,nonce:randomUUID()},env);
}
export function validClearance(value:string|undefined,env:Environment,now=Date.now(),origin=configuredAppOrigin(env)) {
  return !!readPayload(value,'clearance',1,clearanceSeconds,env,now,origin);
}
export function createPreference(optional:boolean,env:Environment,now=Date.now(),origin=configuredAppOrigin(env)) {
  const iat=Math.floor(now/1000);
  return signSecurityPayload('preferences',{v:2,purpose:'preferences',origin:validatedAppOrigin(origin,env),iat,exp:iat+preferenceSeconds,optional},env);
}
export function readPreference(value:string|undefined,env:Environment,now=Date.now(),origin=configuredAppOrigin(env)) {
  const payload=readPayload(value,'preferences',2,preferenceSeconds,env,now,origin);
  return payload&&typeof payload.optional==='boolean'?{optional:payload.optional}:null;
}
export function securityCookieOptions(env:Environment,maxAge:number,origin=configuredAppOrigin(env)) {
  return {path:'/',httpOnly:true,sameSite:'lax' as const,secure:validatedAppOrigin(origin,env).startsWith('https:'),maxAge};
}
