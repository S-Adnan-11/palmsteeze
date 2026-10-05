'use client';
import { useId,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
export type AdminField={name:string;label:string;type?:'text'|'money'|'number'|'datetime-local'|'textarea'|'boolean'|'select';value?:string|number|boolean;options?:{value:string;label:string}[]};
export function AdminAction({operation,label,fields=[],fixed={}}:{operation:string;label:string;fields?:AdminField[];fixed?:Record<string,string|boolean>}) {
 const formID=useId();const requestID=useRef<{id:string;input:string}|null>(null);const router=useRouter();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [affected,setAffected]=useState<{bookingId?:string;allocationId?:string;kind?:string}[]>([]);
 return <form className="admin-form" onSubmit={async event=>{
  event.preventDefault();setBusy(true);setMessage('Saving…');setAffected([]);
  try {
   const form=new FormData(event.currentTarget);const body:Record<string,unknown>={operation,...fixed,reason:String(form.get('reason')||'')};
   for(const field of fields) {const value=String(form.get(field.name)||'');body[field.name]=field.type==='number' ? Number(value):field.type==='boolean' ? value==='true':field.type==='datetime-local' ? new Date(`${value}+01:00`).toISOString():value;}
   if(operation==='closure') {const input=JSON.stringify(body);if(requestID.current?.input!==input) requestID.current={id:crypto.randomUUID(),input};body.requestId=requestID.current.id;}
   const response=await fetch('/api/admin/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();
   if(!response.ok) {setMessage(result.error||'Unable to save.');setAffected(result.affected||[]);}else {setMessage('Saved. Provider work remains pending until verified.');router.refresh();}
  } catch {setMessage('The result is uncertain. Refresh the page before retrying; do not assume a refund succeeded.');}finally {setBusy(false);}
 }}>
  {fields.map(field=><div key={field.name}><label htmlFor={`${formID}-${field.name}`}>{field.label}</label>
   {field.type==='textarea' ? <textarea id={`${formID}-${field.name}`} name={field.name} defaultValue={String(field.value||'')} maxLength={1000} required/>
    :field.type==='boolean'||field.type==='select' ? <select id={`${formID}-${field.name}`} name={field.name} defaultValue={String(field.value??(field.type==='boolean' ? true:''))} required>{(field.type==='boolean' ? [{value:'true',label:'Active'},{value:'false',label:'Archived'}]:field.options||[]).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
    :<input id={`${formID}-${field.name}`} name={field.name} type={field.type==='money' ? 'text':field.type||'text'} inputMode={field.type==='money' ? 'decimal':undefined} defaultValue={String(field.value??'')} step={field.type==='number' ? 1:undefined} required/>}</div>)}
  <label htmlFor={`${formID}-reason`}>Reason for {label.toLowerCase()}</label><textarea id={`${formID}-reason`} name="reason" required maxLength={512}/>
  <button className="button" disabled={busy} type="submit">{label}</button><p role="status">{message}</p>
  {affected.length>0&&<ul aria-label="Affected allocations">{affected.map((a,i)=><li key={i}>{a.bookingId ? <Link href={`/admin/bookings/${a.bookingId}`}>Booking {a.bookingId.slice(0,8)}</Link>:<Link href="/admin/availability">Closure {a.allocationId?.slice(0,8)}</Link>}</li>)}</ul>}
 </form>;
}
