import {adminSnapshot} from '@/lib/admin';
import {adminBookingRows} from '@/lib/admin-presentation';
import {BookingsList} from '@/components/admin-presentation';
export default async function AdminBookings() {
  const s=await adminSnapshot('/admin/bookings');
  return <><div className="operation-heading"><div><p className="eyebrow">Reservations & decisions</p><h1>Every visit, in view.</h1><p>Search the latest 100 records. Booking, payment and refund states stay separate.</p></div><span className="environment-label">{s.bookings.length} loaded bookings</span></div><section className="operation-panel"><BookingsList rows={adminBookingRows(s)}/></section></>;
}
