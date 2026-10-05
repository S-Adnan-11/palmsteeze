'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney,parseNaira,type Quote } from '@/lib/domain';
import { visitDestination,type VisitSelection } from '@/lib/auth/destinations';
function quoteExpectation(quote:Quote) {
  return JSON.stringify({hourly_kobo:quote.hourly_kobo,total_kobo:quote.total_kobo,deposit_percent:quote.deposit_percent,deposit_kobo:quote.deposit_kobo,balance_kobo:quote.balance_kobo});
}
export function CreateCheckout({selection,interval,initialQuote,initialAvailable}:{selection:VisitSelection;interval:{starts_at:string;ends_at:string};initialQuote:Quote;initialAvailable:boolean}) {
  const [quote,setQuote]=useState(initialQuote);const [requestId]=useState(()=>crypto.randomUUID());
  const [choice,setChoice]=useState('minimum');const [custom,setCustom]=useState('');
  const [pending,setPending]=useState(false);const [status,setStatus]=useState('');const router=useRouter();
  let selectedAmount:number|null=choice==='full' ? quote.total_kobo:quote.deposit_kobo;
  if(choice==='higher'){try{selectedAmount=parseNaira(custom);}catch{selectedAmount=null;}}
  const validAmount=selectedAmount!==null&&selectedAmount>=quote.deposit_kobo&&selectedAmount<=quote.total_kobo;
  async function create() {
    setPending(true);setStatus('Rechecking your quote and preparing secure checkout…');
    try {
      const amount=choice==='minimum' ? quote.deposit_kobo:choice==='full' ? quote.total_kobo:parseNaira(custom);
      if(amount<quote.deposit_kobo||amount>quote.total_kobo) throw new Error('Choose an amount between the minimum deposit and booking total.');
      const query=new URLSearchParams({resource:selection.resource,start:interval.starts_at,end:interval.ends_at});
      const current=await fetch(`/api/quote?${query}`,{cache:'no-store'});const value=await current.json();
      if(!current.ok) throw new Error(value.error||'Please choose another time.');
      if(quoteExpectation(quote)!==quoteExpectation(value.quote)) {setQuote(value.quote);setStatus('The quote changed. Review it, then choose checkout again.');return;}
      const response=await fetch('/api/checkout',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({resourceId:selection.resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId,expectedQuote:quoteExpectation(quote),amountKobo:String(amount)})});
      if(response.status===401) {window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(visitDestination(selection))}`);return;}
      const data=await response.json();if(!response.ok) throw new Error(data.error||'Checkout could not be prepared. Open your visits before starting another.');
      // Always land on the owned booking page. It validates Stripe's URL and
      // offers resume; a browser return URL never confirms payment.
      router.push(`/booking/${data.booking.id}`);router.refresh();
    } catch(error) {setStatus(error instanceof Error ? error.message:'Please retry safely.');}
    finally {setPending(false);}
  }
  return <div className="booking-panel"><div className="quote-summary" aria-label="Verified visit quote">
    <p><span>Booking total</span><strong>{formatMoney(quote.total_kobo)}</strong></p>
    <p><span>{quote.deposit_percent}% deposit</span><strong>{formatMoney(quote.deposit_kobo)}</strong></p>
    <p><span>Balance with minimum deposit</span><span>{formatMoney(quote.balance_kobo)}</span></p></div>
    <label htmlFor="payment-choice">Amount to pay now</label><select id="payment-choice" value={choice} onChange={event=>setChoice(event.target.value)} disabled={pending}>
      <option value="minimum">Minimum deposit ({formatMoney(quote.deposit_kobo)})</option><option value="higher">Choose a higher amount</option><option value="full">Full payment ({formatMoney(quote.total_kobo)})</option></select>
    {choice==='higher'&&<><label htmlFor="payment-naira">Payment amount in naira</label><input id="payment-naira" inputMode="decimal" type="text" value={custom} onChange={event=>setCustom(event.target.value)} disabled={pending}/></>}
    {validAmount&&<div className="quote-summary"><p><span>Selected payment</span><strong>{formatMoney(selectedAmount!)}</strong></p><p><span>Balance after verified payment</span><strong>{formatMoney(quote.total_kobo-selectedAmount!)}</strong></p></div>}
    {choice==='full'&&<p>No balance remains after verified full payment.</p>}
    <p>Approved cancellations refund the entire amount collected, less any amount already refunded. Cancellation approval and provider-confirmed refund completion are separate.</p>
    <button className="button" disabled={pending||!initialAvailable} onClick={create}>{pending ? 'Preparing checkout…':'Reserve with sandbox payment'}</button>
    <p role="status" className="booking-status">{status||(initialAvailable ? 'The database rechecks availability and your reviewed price atomically.':'This space is occupied or closed. Choose another time.')}</p>
    <p className="signin-note">Sandbox cards only; no real funds. Venue settings and hourly prices remain proposed. The 40% working deposit was approved after payment feasibility testing.</p></div>;
}
export function CheckoutStatusActions({id,canCancel,initialState}:{id:string;canCancel:boolean;initialState:string}) {
  const router=useRouter();const [pending,setPending]=useState(false);const [status,setStatus]=useState('');
  useEffect(()=>{
    if(!['creating','open','refund_required'].includes(initialState)) return;
    let active=true;let checks=0;
    const verify=async()=>{
      if(!active||checks++>=12) return;
      try {
        const response=await fetch(`/api/bookings/${id}`,{credentials:'same-origin',cache:'no-store'});
        if(response.ok) {
          const detail=await response.json();
          if(active&&detail.payment?.state!==initialState) router.refresh();
        }
      } catch { /* Scheduled reconciliation and the visible retry remain available. */ }
    };
    void verify();const timer=setInterval(()=>void verify(),5000);
    window.addEventListener('pageshow',verify);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('pageshow',verify);};
  },[id,initialState,router]);
  async function action(cancel:boolean) {
    setPending(true);setStatus(cancel ? 'Asking Stripe to safely stop checkout…':'Checking the authoritative payment status…');
    try {
      const response=await fetch(`/api/bookings/${id}${cancel ? '/checkout':''}`,{method:cancel ? 'DELETE':'GET',credentials:'same-origin',cache:'no-store'});
      if(response.status===401) {window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);return;}
      const value=await response.json();if(!response.ok) throw new Error(value.error||'Please retry.');
      setStatus(value.payment?.state==='open'||value.payment?.state==='creating' ? 'Payment is still pending. Your allocation remains protected.':'Verified status updated.');router.refresh();
    } catch(error) {setStatus(error instanceof Error ? error.message:'Please retry.');}finally{setPending(false);}
  }
  return <div><button className="button" disabled={pending} onClick={()=>action(false)}>Refresh verified status</button>{canCancel && <button className="button" disabled={pending} onClick={()=>action(true)}>Stop unpaid checkout</button>}<p role="status">{status}</p></div>;
}
export function RequestCancellation({id}:{id:string}) {
 const [reason,setReason]=useState('');const [pending,setPending]=useState(false);const [status,setStatus]=useState('');const router=useRouter();
 async function request(event:React.SubmitEvent<HTMLFormElement>) {
  event.preventDefault();setPending(true);
  try {
   const response=await fetch(`/api/bookings/${id}/cancellation`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});
   if(response.status===401) {window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);return;}
   const data=await response.json();if(!response.ok) throw new Error(data.error||'Please retry.');
   setStatus('Cancellation requested. Your visit stays confirmed and allocated until an administrator decides.');router.refresh();
  } catch(error) {setStatus(error instanceof Error ? error.message:'Please retry.');}finally{setPending(false);}
 }
 return <form onSubmit={request}><label htmlFor="cancellation-reason">Reason for cancellation request</label><textarea id="cancellation-reason" required minLength={1} maxLength={512} value={reason} onChange={event=>setReason(event.target.value)}/><button className="button" disabled={pending} type="submit">Request cancellation</button><p role="status">{status}</p><p>Administrator decisions and refunds follow separately. Requesting alone does not release this space.</p></form>;
}
