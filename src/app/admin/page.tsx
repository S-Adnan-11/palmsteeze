import {adminSnapshot} from '@/lib/admin';
import {adminBookingRows} from '@/lib/admin-presentation';
import {formatMoney} from '@/lib/domain';
import {DayOperations,OverviewPresentation} from '@/components/admin-presentation';
export default async function AdminOverview() {
  const s=await adminSnapshot();const {metrics:m}=s;
  const unresolved=s.payments.filter(p=>p.refund_blocked||p.state==='refund_required'||p.state==='review_required');
  const outstanding=unresolved.reduce((sum,p)=>sum+Math.max(0,Number(p.collected_kobo)-Number(p.refunded_kobo)),0);
  const blocked=unresolved.find(p=>p.refund_blocked);const customer=s.bookings.find(b=>b.id===blocked?.booking_id)?.customer_identity.name;
  const date=new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date())+' · Lagos time (WAT)';
  const day=(value:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
  const arrivals=s.bookings.filter(b=>b.state==='confirmed'&&day(new Date(b.starts_at))===day(new Date()));
  const next=s.bookings.filter(b=>b.state==='confirmed'&&Date.parse(b.starts_at)>Date.now()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
  const nextLabel=next?`${s.resources.find(r=>r.id===next.resource_id)?.name||'Workspace'} · ${new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',dateStyle:'short',timeStyle:'short'}).format(new Date(next.starts_at))} WAT`:'No upcoming visit in the loaded list';
  return <><OverviewPresentation title="A clear view of today." date={date} operations={<DayOperations arrivals={arrivals.length} next={nextLabel} hours={`${String(s.settings.opens_hour).padStart(2,'0')}:00–${String(s.settings.closes_hour).padStart(2,'0')}:00 WAT`}/>} rows={adminBookingRows(s)} metrics={[
    {label:'Confirmed bookings',value:m.confirmed_bookings,note:'Current stored total'},
    {label:'Payments received',value:formatMoney(m.received_deposits_kobo),note:'Verified collection · all time'},
    {label:'Refunds returned',value:formatMoney(m.successful_refunds_kobo),note:'Verified successful refunds · all time'},
    {label:'Needs attention',value:m.pending_cancellations+m.recovery_cases,note:`${m.pending_cancellations} requests · ${m.recovery_cases} recovery cases`,accent:true}
  ]} attention={{count:m.pending_cancellations+m.recovery_cases,outstandingKobo:outstanding,blocked:Boolean(blocked),name:customer}}/><div className="operation-note"><strong>Confirmed booking value: {formatMoney(m.confirmed_value_kobo)}</strong><span>Quoted booking value is separate from received payments. Lists and reimbursement subtotals cover the latest 100 loaded records.</span></div></>;
}
