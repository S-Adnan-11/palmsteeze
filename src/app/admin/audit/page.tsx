import { adminSnapshot,venueTime,shortID } from '@/lib/admin';
import { AdminIdentityDetails } from '@/components/admin-identity';
import { formatMoney } from '@/lib/domain';
function displayChanges(value:unknown):unknown {
 if(Array.isArray(value)) return value.map(displayChanges);
 if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>key.endsWith('_kobo')&&typeof item==='number' ? [key.replace(/_kobo$/,' (naira)'),formatMoney(item)]:[key,displayChanges(item)]));
 return value;
}
export default async function AdminAudit() {
 const s=await adminSnapshot('/admin/audit');return <><h1>Actions, <em>recorded.</em></h1><p>Latest 100 immutable audit records. Explicit account assignments, administrator reasons and verified backend transitions are traceable. Private identity details are restricted to assigned administrators.</p><div className="admin-list">{s.audit.map(a=><article className="admin-card" key={a.id}><h2>{a.action.replaceAll('_',' ')}</h2><p>{venueTime(a.created_at)} · Target: {shortID(a.target_id)}</p><AdminIdentityDetails identity={a.actor_snapshot} label="Acting administrator"/><p>Action timestamp: {a.created_at}</p><p>{a.reason}</p><details><summary>Recorded changes</summary><pre>{JSON.stringify(displayChanges(a.changes),null,2)}</pre></details></article>)}</div></>;
}
