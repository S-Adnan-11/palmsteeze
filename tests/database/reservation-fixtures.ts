// Trusted proof issuer only. Never import into application or expose as an endpoint.
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Client} from 'pg';
import {reservationCapability} from '../../src/lib/reservation-capability';
import {signSecurityPayload} from '../../src/lib/security-sessions';
type Args={p_resource:string;p_start:string;p_end:string;p_request:string;p_expected?:Record<string,number>|null;p_amount?:number|null};
export async function fixtureCheckout(api:SupabaseClient,args:Args) {
  const user=(await api.auth.getUser()).data.user;
  if(!user)throw new Error('Verified synthetic identity required');
  const p_amount=args.p_amount??null;
  const p_capability=reservationCapability({userId:user.id,operation:'checkout',resourceId:args.p_resource,startsAt:args.p_start,endsAt:args.p_end,requestId:args.p_request,amountKobo:p_amount,expectedQuote:args.p_expected??null},process.env);
  return api.rpc('begin_verified_checkout',{...args,p_amount,p_capability});
}
export async function fixtureReservationQuery(peer:Client,sql:string,args:unknown[]) {
  const user=(await peer.query('select auth.uid() id')).rows[0].id;
  // Negative anonymous proofs get an invalid grant, not a privileged identity.
  const operation=sql.includes('create_hold')?'hold':'checkout';
  let cap='invalid';
  if(user){
    cap=reservationCapability({userId:user,operation,resourceId:String(args[0]),startsAt:Number.isFinite(Date.parse(String(args[1])))?String(args[1]):new Date().toISOString(),endsAt:Number.isFinite(Date.parse(String(args[2])))?String(args[2]):new Date().toISOString(),requestId:String(args[3]),amountKobo:args[5] as number??null,expectedQuote:args[4] as Record<string,number>??null},process.env);
    // Preserve original PostgreSQL infinity rejection proofs. The production
    // endpoint rejects non-finite timestamps before issuing a capability.
    if(args[1]==='infinity'||args[2]==='infinity'){const payload=JSON.parse(Buffer.from(cap.split('.')[0],'base64url').toString());payload.start=String(args[1]);payload.end=String(args[2]);cap=signSecurityPayload('reservation',payload,process.env);}
  }
  if(operation==='hold')return peer.query(sql.replace('create_hold($1,$2,$3,$4)','create_verified_hold($1,$2,$3,$4,$5)'),[...args,cap]);
  return peer.query(sql.replace('begin_checkout($1,$2,$3,$4,$5)','begin_verified_checkout($1,$2,$3,$4,$5,$6,$7)'),[...args,args[5]??null,cap]);
}
