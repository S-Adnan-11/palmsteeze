import { adminSnapshot,venueTime } from '@/lib/admin';
import { formatMoney } from '@/lib/domain';
import { AdminAction } from '@/components/admin-action';
import Image from 'next/image';
import {spaceImage} from '@/lib/space-images';
import {StatePill} from '@/components/admin-presentation';
export default async function AdminSpaces() {
 const s=await adminSnapshot('/admin/spaces');return <><h1>Spaces & <em>future rates.</em></h1><p>Active bookings prevent archiving. New rates apply from their effective time.</p><div className="admin-list">
 {s.resources.map(r=>{const image=spaceImage(r.seats>1?'room':r.code.startsWith('QUIET')?'quiet_desk':'open_desk',r.seats);return <details className="admin-card resource-detail" key={r.id}><summary><Image src={image.src} alt="" width={84} height={64}/><span>{r.name}<small>{r.code} · {r.seats} {r.seats===1?'seat':'seats'}</small></span><StatePill state={r.active?'Active':'Archived'}/></summary>
 <p>{r.seats} seats. Recent rates: {s.rates.filter(rate=>rate.resource_id===r.id).slice(0,4).map(rate=>`${formatMoney(rate.hourly_kobo)} from ${venueTime(rate.effective_at)}`).join('; ')}</p>
 <div className="admin-grid"><AdminAction operation="resource" label="Save resource" fixed={{resourceId:r.id}} fields={[{name:'name',label:'Resource name',value:r.name},{name:'description',label:'Description',type:'textarea',value:r.description},{name:'active',label:'Resource status',type:'boolean',value:r.active}]}/>
 <AdminAction operation="rate" label="Schedule future rate" fixed={{resourceId:r.id}} fields={[{name:'hourlyNaira',label:'Hourly price in naira',type:'money'},{name:'effectiveAt',label:'Effective date/time (Lagos)',type:'datetime-local'}]}/></div></details>;})}</div></>;
}
