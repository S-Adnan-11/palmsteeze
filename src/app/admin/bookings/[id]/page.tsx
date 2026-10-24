import { notFound } from 'next/navigation';
import { adminSnapshot,venueTime,shortID } from '@/lib/admin';
import { formatMoney,uuidPattern } from '@/lib/domain';
import { AdminAction } from '@/components/admin-action';
import { AdminIdentityDetails } from '@/components/admin-identity';
import {RefundCase} from '@/components/refund-case';
export default async function AdminBooking({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;if(!uuidPattern.test(id)) notFound();const s=await adminSnapshot(`/admin/bookings/${id}`);const b=s.bookings.find(b=>b.id===id);if(!b) notFound();
 const p=s.payments.find(p=>p.booking_id===id);const requests=s.cancellations.filter(c=>c.booking_id===id);
 return <><h1>Booking <em>{shortID(id)}.</em></h1><p>{s.resources.find(r=>r.id===b.resource_id)?.name} · {venueTime(b.starts_at)} to {venueTime(b.ends_at)}</p>
 <section className="admin-card"><h2>Stored booking</h2><p>Booking reference: {id}</p><AdminIdentityDetails identity={b.customer_identity} label="Customer (current profile)"/><p>Total: {formatMoney(b.total_kobo)} · {b.deposit_percent}% minimum deposit: {formatMoney(b.deposit_kobo)} · Original minimum-deposit balance: {formatMoney(b.balance_kobo)}</p>
 <p>Amount paid: {formatMoney(Number(p?.collected_kobo||0))} · Amount refunded: {formatMoney(Number(p?.refunded_kobo||0))}</p><p>{b.state==='cancelled' ? `Remaining refundable amount: ${formatMoney(Number(p?.collected_kobo||0)-Number(p?.refunded_kobo||0))}`:`Outstanding balance: ${formatMoney(Number(b.total_kobo)-Number(p?.collected_kobo||0)+Number(p?.refunded_kobo||0))}`}</p>
 <p data-testid="admin-booking-state">Booking: {b.state}</p><p>Payment: {p?.state||'legacy unpaid'} · Refund: {p?.refund_state||'none'}</p>
 {b.payment_kind==='legacy'&&<p>Original unpaid hold. Its snapshot is retained; it cannot be marked paid or refunded.</p>}</section>
 {requests.map(c=><section className="admin-card" key={c.id}><h2>Cancellation request</h2><p>Booking reference: {c.booking_id}</p><AdminIdentityDetails identity={c.customer_identity} label="Customer at request"/><p data-testid="admin-cancellation-state">Decision: {c.state}</p><p>Customer reason: {c.reason}</p>{c.decision_reason&&<><p>Administrator reason: {c.decision_reason}</p><AdminIdentityDetails identity={c.administrator_identity} label="Acting administrator at decision"/>{c.decided_at&&<p>Decision timestamp: {c.decided_at} ({venueTime(c.decided_at)})</p>}</>}
 {c.state==='pending'&&<div className="admin-grid"><AdminAction operation="decide" label="Approve and queue full refund" fixed={{requestId:c.id,approve:true}}/><AdminAction operation="decide" label="Reject cancellation" fixed={{requestId:c.id,approve:false}}/></div>}</section>)}
 {p&&<section className="admin-card"><RefundCase payment={p} refunds={s.refunds}/><p>Refund completion is shown separately from cancellation.</p>{!p.refund_blocked&&<AdminAction operation="recover" label="Retry provider verification" fixed={{bookingId:id}}/>}</section>}
 <section className="admin-card"><h2>Complete booking audit</h2><ol className="audit-timeline">{s.audit.filter(a=>a.target_id===id).map(a=><li key={a.id}><strong>{a.action.replaceAll('_',' ')}</strong><p>{venueTime(a.created_at)} · {a.reason}</p><AdminIdentityDetails identity={a.actor_snapshot} label="Acting administrator"/></li>)}</ol></section></>;
}
