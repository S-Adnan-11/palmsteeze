import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicConfiguration } from './supabase/server';
export type BookingRecord={id:string;resource_id:string;starts_at:string;ends_at:string;total_kobo:number;deposit_kobo:number;balance_kobo:number;
  deposit_percent:number;state:string;payment_kind:string;expires_at:string;created_at:string};
export type PaymentRecord={id:string;booking_id:string;state:string;refund_state:string;refund_blocked:boolean;refund_failure_reason:string|null;checkout_url:string|null;cancel_requested:boolean;provider_expires_at:string|null;amount_kobo:number;collected_kobo:number;refunded_kobo:number};
export async function recoverBooking(id:string) {
  const config=publicConfiguration();const token=process.env.PALMSTEEZE_PAYMENT_WORKER_TOKEN;
  if(!config || !token) return false;
  try {
    const response=await fetch(`${config.url}/functions/v1/palmsteeze-payments/recover`,{method:'POST',cache:'no-store',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:id}),signal:AbortSignal.timeout(40000)});
    return response.ok;
  } catch {return false;}
}
export async function customerBooking(client:SupabaseClient,id:string,reconcile=true) {
  // RLS establishes ownership BEFORE any privileged recovery is requested.
  let booking=await client.from('bookings').select('*').eq('id',id).maybeSingle();
  if(booking.error || !booking.data) return null;
  let payment=await client.from('payment_attempts').select('*').eq('booking_id',id).maybeSingle();
  if(payment.error) throw new Error('Payment state unavailable');
  if(reconcile && payment.data && ['creating','open','refund_required'].includes(payment.data.state)) {
    await recoverBooking(id);
    booking=await client.from('bookings').select('*').eq('id',id).maybeSingle();
    payment=await client.from('payment_attempts').select('*').eq('booking_id',id).maybeSingle();
    if(booking.error || payment.error || !booking.data) throw new Error('Booking state unavailable');
  }
  return {booking:booking.data as BookingRecord,payment:payment.data as PaymentRecord|null};
}
export function hostedCheckoutURL(value:unknown) {
  if(typeof value!=='string') return null;
  try {const url=new URL(value);return url.protocol==='https:' && url.hostname==='checkout.stripe.com' && !url.username && !url.password ? value:null;} catch {return null;}
}
