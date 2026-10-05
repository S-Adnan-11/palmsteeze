import 'server-only';
import { redirect,notFound } from 'next/navigation';
import { customerSession } from './supabase/server';
export type AdminIdentity={user_id:string|null;name:string;email:string|null;captured_at:string;historical_identity_unavailable:boolean};
export type AdminBooking={id:string;owner_id:string;resource_id:string;starts_at:string;ends_at:string;state:string;payment_kind:string;total_kobo:number;deposit_kobo:number;balance_kobo:number;deposit_percent:number;customer_identity:AdminIdentity};
export type AdminPayment={id:string;booking_id:string;state:string;refund_state:string;refund_blocked:boolean;refund_failure_reason:string|null;refund_blocked_at:string|null;amount_kobo:number;collected_kobo:number;refunded_kobo:number;payment_intent_id:string|null;session_id:string|null;refund_id:string|null;refund_generation:number};
export type AdminCancellation={id:string;booking_id:string;state:string;reason:string;decision_reason:string|null;decided_at:string|null;decided_by:string|null;customer_identity:AdminIdentity;administrator_identity:AdminIdentity|null};
export type AdminResource={id:string;code:string;name:string;description:string;active:boolean;seats:number};
export type AdminSnapshot={metrics:Record<string,number>;settings:{opens_hour:number;closes_hour:number;deposit_percent:number};resources:AdminResource[];
 bookings:AdminBooking[];payments:AdminPayment[];cancellations:AdminCancellation[];
 rates:{id:string;resource_id:string;effective_at:string;hourly_kobo:number}[];
 closures:{id:string;resource_id:string;starts_at:string;ends_at:string;reason:string;active:boolean}[];
 jobs:{attempt_id:string;attempts:number;next_attempt_at:string;last_error:string|null;leased:boolean}[];
 refunds:{id:string;attempt_id:string;generation:number;refund_id:string|null;state:string;amount_kobo:number;provider_failure_reason?:string|null}[];
 audit:{id:string;actor_id:string|null;actor_snapshot:AdminIdentity;action:string;target_id:string|null;reason:string;created_at:string;changes:Record<string,unknown>}[]};
export async function adminSession(destination='/admin') {
 const session=await customerSession();if(!session) redirect(`/login?next=${encodeURIComponent(destination)}`);
 const role=await session.client.rpc('is_admin');if(role.error||role.data!==true) notFound();return session;
}
export async function adminSnapshot(destination='/admin'):Promise<AdminSnapshot> {
 const session=await adminSession(destination);const detail=destination.match(/^\/admin\/bookings\/([0-9a-f-]+)$/i);
 const result=detail ? await session.client.rpc('admin_booking_snapshot',{p_booking:detail[1]}):await session.client.rpc('admin_snapshot');
 if(result.error||!result.data) throw new Error('Administration is temporarily unavailable.');return result.data as AdminSnapshot;
}
export const shortID=(value:string|null)=>value ? value.slice(0,8):'Backend';
export const venueTime=(value:string)=>new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' WAT';
