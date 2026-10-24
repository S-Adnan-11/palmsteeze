import Link from 'next/link';
import { adminSnapshot,venueTime,shortID } from '@/lib/admin';
import { AdminAction } from '@/components/admin-action';
import { formatMoney } from '@/lib/domain';
import {RefundCase} from '@/components/refund-case';
export default async function AdminRecovery() {
 const s=await adminSnapshot('/admin/recovery');return <><h1>Refunds & <em>recovery.</em></h1><p>Review pending and failed payments. Verify uncertain outcomes before retrying.</p>
 <div className="admin-list">{s.payments.map(p=>{const j=s.jobs.find(j=>j.attempt_id===p.id);return <section className="admin-card" key={p.id} data-payment-id={p.id}><h2><Link href={`/admin/bookings/${p.booking_id}`}>Booking {shortID(p.booking_id)}</Link></h2>
 <p>Selected payment: {formatMoney(p.amount_kobo)} · Payment: {p.state}</p><p data-testid="admin-refund-state">Refund: {p.refund_state}</p><p>Attempt reference: {p.id}</p><p>Provider references: {p.payment_intent_id||'not recorded'} · {p.refund_id||'refund not recorded'}</p>
 {j&&<p>Retry attempts: {j.attempts} · Next retry: {venueTime(j.next_attempt_at)} · {j.leased ? 'Processing':'Queued'} · Last result: {j.last_error||'none'}</p>}
 {s.refunds.filter(r=>r.attempt_id===p.id).map(r=><p key={r.id}>Refund operation {r.generation}: {r.state} · {formatMoney(r.amount_kobo)}</p>)}
 <RefundCase payment={p} refunds={s.refunds}/>
 {!p.refund_blocked&&['creating','open','refund_required','review_required'].includes(p.state)&&<AdminAction operation="recover" label="Retry provider verification" fixed={{bookingId:p.booking_id}}/>}</section>;})}
 {s.payments.length===0&&<p>No payment attempts or refund cases yet.</p>}</div></>;
}
