import type {AdminIdentity} from '@/lib/admin';
export function AdminIdentityDetails({identity,label}:{identity:AdminIdentity|null;label:string}) {
 return identity ? <div className="admin-identity"><p>{label}: {identity.name}</p><p>Email: {identity.email||'Unavailable'}</p><p>Stable user ID: {identity.user_id||'System worker'}</p>
 {identity.historical_identity_unavailable&&<p>Current identity lookup; historical name/email was not captured at the time.</p>}</div>:<p>{label}: attribution unavailable.</p>;
}
