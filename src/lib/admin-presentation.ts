import 'server-only';
import {venueTime,type AdminSnapshot} from '@/lib/admin';
import type {BookingRow} from '@/components/admin-presentation';
export function adminBookingRows(s:AdminSnapshot):BookingRow[] {
  return s.bookings.map(b=>{
    const p=s.payments.find(p=>p.booking_id===b.id);
    return {id:b.id,reference:b.id.slice(0,8).toUpperCase(),name:b.customer_identity.name||'Customer',email:b.customer_identity.email,space:s.resources.find(r=>r.id===b.resource_id)?.name||'Workspace',time:venueTime(b.starts_at),booking:b.state,payment:p?.state||'legacy unpaid',refund:p?.refund_blocked?'failed — assistance required':p?.refund_state||'none',paidKobo:Number(p?.collected_kobo||0),href:`/admin/bookings/${b.id}`,pendingRequest:s.cancellations.some(c=>c.booking_id===b.id&&c.state==='pending')};
  });
}
