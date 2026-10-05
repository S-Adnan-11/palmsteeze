'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney,type Quote } from '@/lib/domain';
import type { VisitSelection } from '@/lib/auth/destinations';
import { visitDestination } from '@/lib/auth/destinations';

export function CreateHold({selection,interval,initialQuote,initialAvailable}:{selection:VisitSelection;interval:{starts_at:string;ends_at:string};initialQuote:Quote;initialAvailable:boolean}) {
  const router = useRouter();const [quote,setQuote] = useState(initialQuote);
  const [pending,setPending] = useState(false);const [status,setStatus] = useState('');
  const [available,setAvailable] = useState(initialAvailable);const [requestId] = useState(() => crypto.randomUUID());
  async function create() {
    setPending(true);setStatus('Rechecking availability and price…');
    try {
      const params = new URLSearchParams({resource:selection.resource,start:interval.starts_at,end:interval.ends_at});
      const [a,q] = await Promise.all([fetch(`/api/availability?${params}`,{cache:'no-store'}),fetch(`/api/quote?${params}`,{cache:'no-store'})]);
      const [availability,current] = await Promise.all([a.json(),q.json()]);
      if (!a.ok || !q.ok) throw new Error(availability.error || current.error || 'Please choose another time.');
      if (!availability.availability.find((r:{resource_id:string;available:boolean}) => r.resource_id === selection.resource)?.available) {
        setAvailable(false);setStatus('This space is now occupied or closed. Choose another space or time.');return;
      }
      setAvailable(true);
      if (['total_kobo','hourly_kobo','deposit_percent','deposit_kobo','balance_kobo'].some((key) => current.quote[key] !== quote[key as keyof Quote])) {
        setQuote(current.quote);setStatus('The price changed. Review the updated quote, then choose Create temporary hold again.');return;
      }
      const response = await fetch('/api/holds',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({resourceId:selection.resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId})});
      if (response.status === 401) {
        window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(visitDestination(selection))}`);return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The hold could not be created. You can retry safely.');
      router.push('/account');router.refresh();
    } catch(error) {setStatus(error instanceof Error ? error.message : 'Please retry.');}
    finally {setPending(false);}
  }
  return <div className="booking-panel"><div className="quote-summary" aria-label="Verified visit quote"><p><span>Quoted total</span><strong>{formatMoney(quote.total_kobo)}</strong></p>
    <p><span>{quote.deposit_percent}% proposed deposit</span><span>{formatMoney(quote.deposit_kobo)}</span></p><p><span>Balance at venue</span><span>{formatMoney(quote.balance_kobo)}</span></p></div>
    <button className="button" onClick={create} disabled={pending || !available}>{pending ? 'Rechecking…' : 'Create temporary hold'}</button>
    <p role="status" className="booking-status">{status || (available ? 'Available when checked. The database revalidates before allocating.' : 'This space is occupied or closed. Choose another time.')}</p>
    <p className="signin-note">Temporary hold only. No payment or confirmed booking. Unpaid holds expire under the current M1 policy.</p></div>;
}

export function ReleaseHold({id}:{id:string}) {
  const router = useRouter();const [pending,setPending] = useState(false);const [status,setStatus] = useState('');
  async function release() {
    setPending(true);
    try {
      const result = await fetch(`/api/holds/${id}`,{method:'DELETE',credentials:'same-origin',cache:'no-store'});
      if (result.status === 401) {window.location.assign('/login?message=session-ended&next=%2Faccount');return;}
      if (!result.ok) throw new Error('This hold could not be released. Please refresh and retry.');
      setStatus('Hold released.');router.refresh();
    } catch(error) {setStatus(error instanceof Error ? error.message : 'Please retry.');}
    finally {setPending(false);}
  }
  return <div><button className="button" type="button" disabled={pending} onClick={release}>{pending ? 'Releasing…' : 'Release hold'}</button><p role="status">{status}</p></div>;
}
