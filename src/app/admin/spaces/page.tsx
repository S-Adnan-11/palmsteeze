import { adminSnapshot,venueTime } from '@/lib/admin';
import { formatMoney } from '@/lib/domain';
import { AdminAction } from '@/components/admin-action';
export default async function AdminSpaces() {
 const s=await adminSnapshot('/admin/spaces');return <><h1>Spaces & <em>future rates.</em></h1><p>Keep the 27-resource inventory and original snapshots. Archiving is blocked by active allocations; rates apply only after their effective time.</p><div className="admin-list">
 {s.resources.map(r=><details className="admin-card" key={r.id}><summary>{r.name} · {r.code} · {r.active ? 'Active':'Archived'}</summary>
 <p>{r.seats} seats. Recent rates: {s.rates.filter(rate=>rate.resource_id===r.id).slice(0,4).map(rate=>`${formatMoney(rate.hourly_kobo)} from ${venueTime(rate.effective_at)}`).join('; ')}</p>
 <div className="admin-grid"><AdminAction operation="resource" label="Save resource" fixed={{resourceId:r.id}} fields={[{name:'name',label:'Resource name',value:r.name},{name:'description',label:'Description',type:'textarea',value:r.description},{name:'active',label:'Resource status',type:'boolean',value:r.active}]}/>
 <AdminAction operation="rate" label="Schedule future rate" fixed={{resourceId:r.id}} fields={[{name:'hourlyNaira',label:'Hourly price in naira',type:'money'},{name:'effectiveAt',label:'Effective date/time (Lagos)',type:'datetime-local'}]}/></div></details>)}</div></>;
}
