import Link from 'next/link';
import { adminSnapshot } from '@/lib/admin';
import { formatMoney } from '@/lib/domain';
export default async function AdminOverview() {
 const {metrics}=await adminSnapshot();return <><h1>Your workspace, <em>in view.</em></h1><p>Live database totals. Deposits and booking value are separate; all payments are simulated.</p>
 <div className="admin-grid">{[['Confirmed bookings',metrics.confirmed_bookings],['Confirmed booking value',formatMoney(metrics.confirmed_value_kobo)],['Verified payments received',formatMoney(metrics.received_deposits_kobo)],['Verified refunds returned',formatMoney(metrics.successful_refunds_kobo)],['Pending cancellation requests',metrics.pending_cancellations],['Recovery cases',metrics.recovery_cases]].map(([label,value])=><section className="admin-card" key={label}><h2>{label}</h2><p className="admin-metric">{value}</p></section>)}</div>
 <p><Link href="/admin/bookings">Review cancellation requests</Link> · <Link href="/admin/recovery">Inspect refunds and retries</Link></p></>;
}
