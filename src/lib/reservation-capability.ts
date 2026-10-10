import {randomUUID} from 'node:crypto';
import {signSecurityPayload} from './security-sessions';
import {configuredAppOrigin} from './deployment';

export type ReservationIntent={userId:string;operation:'hold'|'checkout';resourceId:string;startsAt:string;endsAt:string;requestId:string;amountKobo:number|null;expectedQuote:Record<string,number>|null};
export function reservationCapability(intent:ReservationIntent,env:Record<string,string|undefined>,now=Date.now()) {
  const iat=Math.floor(now/1000);
  return signSecurityPayload('reservation',{
    v:1,purpose:'reservation',origin:configuredAppOrigin(env),nonce:randomUUID(),sub:intent.userId,operation:intent.operation,
    resource:intent.resourceId,start:new Date(intent.startsAt).toISOString(),end:new Date(intent.endsAt).toISOString(),request:intent.requestId,
    amount:intent.amountKobo,quote:intent.expectedQuote,iat,exp:iat+60,
  },env);
}
