'use client';
import { useEffect,useRef,useState,useTransition } from 'react';
import type {SecurityChallengeHandle} from '@/components/security-challenge';
import Link from 'next/link';
import {ReservationSecurity} from '@/components/reservation-security';
import {tabMemoryAllowed,useTabMemory} from '@/components/tab-memory';
import { useRouter } from 'next/navigation';
import { formatMoney,parseNaira,type Quote } from '@/lib/domain';
import { visitDestination,editVisitDestination,type VisitSelection } from '@/lib/auth/destinations';
import {ChoiceCard} from '@/components/choice-card';
import {formatVisitDate} from '@/lib/visit-dates';
function quoteExpectation(quote:Quote) {
  return JSON.stringify({hourly_kobo:quote.hourly_kobo,total_kobo:quote.total_kobo,deposit_percent:quote.deposit_percent,deposit_kobo:quote.deposit_kobo,balance_kobo:quote.balance_kobo});
}
export function CreateCheckout({selection,interval,initialQuote,initialAvailable}:{selection:VisitSelection;interval:{starts_at:string;ends_at:string};initialQuote:Quote;initialAvailable:boolean}) {
  const [quote,setQuote]=useState(initialQuote);const [requestId]=useState(()=>crypto.randomUUID());
  const [available,setAvailable]=useState(initialAvailable);
  useEffect(()=>{setAvailable(initialAvailable);},[initialAvailable]);
  // A server refresh (including a blocked visit's recheck) must update the
  // displayed authoritative quote without losing payment intent/idempotency.
  useEffect(()=>{setQuote(initialQuote);},[initialQuote]);
  const [choice,setChoice]=useState('minimum');const [custom,setCustom]=useState('');
  const [pending,setPending]=useState(false);const [status,setStatus]=useState('');const router=useRouter();
  const [refreshing,startRefresh]=useTransition();
  const creating=useRef(false);const [paymentReady,setPaymentReady]=useState(false);
  const security=useRef<SecurityChallengeHandle>(null);
  const paymentKey='palmsteeze.payment.v1:'+visitDestination(selection);
  const memory=useTabMemory();
  const restoredPayment=useRef('');
  useEffect(()=>{
    if(!memory.ready||restoredPayment.current===paymentKey) return;
    restoredPayment.current=paymentKey;
    try {
      const saved=memory.allowed?JSON.parse(sessionStorage.getItem(paymentKey)||'null'):null;
      if(saved&&['minimum','higher','full'].includes(saved.choice)&&typeof saved.custom==='string'&&saved.custom.length<=32) {setChoice(saved.choice);setCustom(saved.custom);}
    } catch { /* Storage is optional. Amounts are always revalidated against the live quote. */ }
    setPaymentReady(true);
  },[paymentKey,memory.ready,memory.allowed]);
  useEffect(()=>{
    if(paymentReady&&memory.allowed&&tabMemoryAllowed()) try {sessionStorage.setItem(paymentKey,JSON.stringify({choice,custom}));} catch { /* Optional tab-local preferences only. */ }
  },[paymentReady,paymentKey,choice,custom,memory.allowed]);
  let selectedAmount:number|null=choice==='full' ? quote.total_kobo:quote.deposit_kobo;
  if(choice==='higher'){try{selectedAmount=parseNaira(custom);}catch{selectedAmount=null;}}
  const validAmount=selectedAmount!==null&&selectedAmount>=quote.deposit_kobo&&selectedAmount<=quote.total_kobo;
  function recheck() {
    setStatus('');
    startRefresh(async()=>{
      try {
        const query=new URLSearchParams({resource:selection.resource,start:interval.starts_at,end:interval.ends_at});
        const [price,slots]=await Promise.all([fetch(`/api/quote?${query}`,{cache:'no-store'}),fetch(`/api/availability?${query}`,{cache:'no-store'})]);
        const [priced,checked]=await Promise.all([price.json(),slots.json()]);
        if(priced.entranceRequired||checked.entranceRequired)window.dispatchEvent(new Event('palmsteeze-entrance-required'));
        if(!price.ok||!slots.ok) throw new Error('We couldn’t recheck this visit. Try again.');
        setQuote(priced.quote);setAvailable(checked.availability.some((slot:{resource_id:string;available:boolean})=>slot.resource_id===selection.resource&&slot.available));
        router.refresh();
      } catch(error) {setStatus(error instanceof Error?error.message:'We couldn’t recheck this visit. Try again.');}
    });
  }
  async function create() {
    if(creating.current) return;creating.current=true;
    setPending(true);setStatus('Checking your visit…');
    try {
      const amount=choice==='minimum' ? quote.deposit_kobo:choice==='full' ? quote.total_kobo:parseNaira(custom);
      if(amount<quote.deposit_kobo||amount>quote.total_kobo) throw new Error('Choose an amount between the minimum deposit and booking total.');
      const query=new URLSearchParams({resource:selection.resource,start:interval.starts_at,end:interval.ends_at});
      const current=await fetch(`/api/quote?${query}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});const value=await current.json();
      if(value.entranceRequired)window.dispatchEvent(new Event('palmsteeze-entrance-required'));
      if(!current.ok) throw new Error(value.error||'Please choose another time.');
      if(quoteExpectation(quote)!==quoteExpectation(value.quote)) {setQuote(value.quote);setStatus('The quote changed. Review it, then choose checkout again.');return;}
      setStatus('Checking security…');
      const securityToken=await security.current!.verify();
      setStatus('Preparing checkout…');
      const response=await fetch('/api/checkout',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Turnstile-Token':securityToken},
        body:JSON.stringify({resourceId:selection.resource,startsAt:interval.starts_at,endsAt:interval.ends_at,requestId,expectedQuote:quoteExpectation(quote),amountKobo:String(amount)})});
      if(response.status===401) {window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(visitDestination(selection))}`);return;}
      const data=await response.json();if(data.entranceRequired)window.dispatchEvent(new Event('palmsteeze-entrance-required'));if(!response.ok) throw new Error(data.error||'Checkout could not be prepared. Open your visits before starting another.');
      // Always land on the owned booking page. It validates Stripe's URL and
      // offers resume; a browser return URL never confirms payment.
      router.push(`/booking/${data.booking.id}`);router.refresh();
    } catch(error) {setStatus(error instanceof Error ? error.message:'Please retry safely.');}
    finally {creating.current=false;setPending(false);}
  }
  return <div className="booking-panel refined-checkout" aria-busy={pending||refreshing}><p className="eyebrow">Your booking summary</p>
    <dl className="visit-facts"><div><dt>Date</dt><dd>{formatVisitDate(selection.date)}</dd></div><div><dt>Time · WAT</dt><dd>{String(selection.hour).padStart(2,'0')}:00–{String(selection.hour+selection.duration).padStart(2,'0')}:00</dd></div><div><dt>Duration</dt><dd>{selection.duration} {selection.duration===1?'hour':'hours'}</dd></div></dl>
    <a href={editVisitDestination(selection)} className="text-link">Edit space, date or hours ↗</a>
    <div className="quote-summary" key={quoteExpectation(quote)} data-feedback={refreshing||pending?'checking':'checked'} aria-label="Verified visit quote"><p><span>Booking total</span><strong>{formatMoney(quote.total_kobo)}</strong></p><p><span>{quote.deposit_percent}% deposit</span><span>{formatMoney(quote.deposit_kobo)}</span></p><p><span>Balance with minimum deposit</span><span>{formatMoney(quote.balance_kobo)}</span></p></div>
    <button className="text-button" type="button" disabled={pending||refreshing} onClick={recheck}>{refreshing?'Rechecking…':'Recheck price & availability'}</button>
    <fieldset className="payment-choices" disabled={pending||refreshing||!paymentReady}><legend>How much would you like to pay now?</legend>
      <ChoiceCard name="payment-choice" value="minimum" checked={choice==='minimum'} onChange={()=>setChoice('minimum')} title="Minimum deposit" detail={quote.deposit_percent+'% now'} amount={formatMoney(quote.deposit_kobo)} disabled={pending}/>
      <ChoiceCard name="payment-choice" value="higher" checked={choice==='higher'} onChange={()=>setChoice('higher')} title="Custom amount" detail="Between deposit and total" disabled={pending}/>
      <ChoiceCard name="payment-choice" value="full" checked={choice==='full'} onChange={()=>setChoice('full')} title="Full payment" detail="No remaining balance" amount={formatMoney(quote.total_kobo)} disabled={pending}/>
    </fieldset>
    <div className="payment-expansion" data-open={choice==='higher'} aria-hidden={choice!=='higher'} inert={choice!=='higher'}><div><div className="custom-payment"><label htmlFor="payment-naira">Payment amount in naira</label><input id="payment-naira" inputMode="decimal" type="text" value={custom} onChange={event=>setCustom(event.target.value)} disabled={pending||refreshing||choice!=='higher'} maxLength={32} aria-describedby="payment-range" aria-invalid={custom.length>0&&!validAmount}/><p id="payment-range" className="payment-range">Enter {formatMoney(quote.deposit_kobo)}–{formatMoney(quote.total_kobo)}. Up to two decimal places.{custom.length>0&&!validAmount&&' Choose an amount within this range to continue.'}</p></div></div></div>
    <div className="pay-now-summary quote-summary" aria-label="Payment summary"><p><span>Amount payable now</span><strong>{validAmount?formatMoney(selectedAmount!):'Choose an amount'}</strong></p><p><span>Remaining after verified payment</span><strong>{validAmount?formatMoney(quote.total_kobo-selectedAmount!):'—'}</strong></p></div>
    <p className="payment-disclosure">Test payments only</p>
    <ReservationSecurity ref={security} disabled={pending}/>
    <button className="button" aria-describedby="security-status" disabled={pending||refreshing||!available||!validAmount||!paymentReady} onClick={create}>{pending?'Preparing checkout…':'Continue to test payment'}</button>
    <p role="status" className="booking-status">{status||(available?'':'This space is occupied or closed. Edit your selection or recheck.')}</p>

    <details className="refund-policy"><summary>Cancellation &amp; refunds</summary><p>Approved cancellations refund paid funds less prior refunds. Approval and completed reimbursement are separate. <Link href="/terms#cancellation">Refund terms</Link></p></details></div>;
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
    setPending(true);setStatus(cancel ? 'Stopping checkout…':'Checking payment status…');
    try {
      const response=await fetch(`/api/bookings/${id}${cancel ? '/checkout':''}`,{method:cancel ? 'DELETE':'GET',credentials:'same-origin',cache:'no-store'});
      if(response.status===401) {window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);return;}
      const value=await response.json();if(!response.ok) throw new Error(value.error||'Please retry.');
      setStatus(value.payment?.state==='open'||value.payment?.state==='creating' ? 'Payment pending. Your space stays held.':'Status updated.');router.refresh();
    } catch(error) {setStatus(error instanceof Error ? error.message:'Please retry.');}finally{setPending(false);}
  }
  return <div className="checkout-status-actions" aria-busy={pending}><div className="journey-actions"><button className="button button-secondary" disabled={pending} onClick={()=>action(false)}>Refresh status</button>{canCancel && <button className="text-button" disabled={pending} onClick={()=>action(true)}>Stop unpaid checkout</button>}</div><p role="status">{status}</p></div>;
}
export function RequestCancellation({id}:{id:string}) {
 const [reason,setReason]=useState('');const [pending,setPending]=useState(false);const [status,setStatus]=useState('');const router=useRouter();
 async function request(event:React.SubmitEvent<HTMLFormElement>) {
  event.preventDefault();setPending(true);
  try {
   const response=await fetch(`/api/bookings/${id}/cancellation`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});
   if(response.status===401) {window.location.assign(`/login?message=session-ended&next=${encodeURIComponent(`/booking/${id}`)}`);return;}
   const data=await response.json();if(!response.ok) throw new Error(data.error||'Please retry.');
   setStatus('Cancellation requested. Your visit stays confirmed until an administrator decides.');router.refresh();
  } catch(error) {setStatus(error instanceof Error ? error.message:'Please retry.');}finally{setPending(false);}
 }
 return <form onSubmit={request}><label htmlFor="cancellation-reason">Reason for cancellation request</label><textarea id="cancellation-reason" required minLength={1} maxLength={512} value={reason} onChange={event=>setReason(event.target.value)}/><button className="button" disabled={pending} type="submit">Request cancellation</button><p role="status">{status}</p><p>Your visit stays confirmed until cancellation is approved.</p></form>;
}
