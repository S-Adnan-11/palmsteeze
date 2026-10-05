import Link from 'next/link';
import { adminSnapshot,venueTime,shortID } from '@/lib/admin';
import { formatMoney } from '@/lib/domain';
export default async function AdminBookings() {
 const s=await adminSnapshot('/admin/bookings');return <><h1>Bookings & <em>decisions.</em></h1><p>Latest 100 bookings. Historical price snapshots are preserved.</p><div className="admin-list">
 {s.bookings.map(b=>{const p=s.payments.find(p=>p.booking_id===b.id);const c=s.cancellations.find(c=>c.booking_id===b.id);return <article className="admin-card" key={b.id}><h2><Link href={`/admin/bookings/${b.id}`}>{s.resources.find(r=>r.id===b.resource_id)?.name} · {shortID(b.id)}</Link></h2>
 <p>{venueTime(b.starts_at)} · Booking: {b.state}</p><p>Deposit snapshot: {formatMoney(b.deposit_kobo)} ({b.deposit_percent}%) · Payment: {p?.state||'legacy unpaid'} · Refund: {p?.refund_state||'none'}</p><p>Cancellation: {c?.state||'none'}</p></article>;})}
 {s.bookings.length===0&&<p>No bookings yet.</p>}</div></>;
}
