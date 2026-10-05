'use client';
import {useState} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {visitDestination} from '@/lib/auth/destinations';
import type {Catalog} from '@/lib/catalog';
import {spaceImage} from '@/lib/space-images';
import {formatMoney,initialBookingDate,intervalFromSelection,validateInterval,workingQuote,type Quote,type ResourceKind} from '@/lib/domain';
const labels={open_desk:'Open desks',quiet_desk:'Quiet desks',room:'Meeting rooms'};

export function WorkspaceExplorer({catalog}:{catalog:Catalog}) {
  const {resources,settings,source}=catalog;
  const [filter,setFilter]=useState<ResourceKind|'all'>('all');
  const [selected,setSelected]=useState(resources.find(r=>r.kind==='open_desk')?.id||resources[0]?.id||'');
  const [date,setDate]=useState(initialBookingDate);
  const [hour,setHour]=useState(settings.opens_hour);
  const [duration,setDuration]=useState(1);
  const [status,setStatus]=useState('');
  const [pending,setPending]=useState(false);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [availability,setAvailability]=useState<boolean|null>(null);
  const resource=resources.find(r=>r.id===selected);
  const kindOrder={open_desk:0,quiet_desk:1,room:2};
  const groups=resources.filter((r,index)=>(filter==='all'||r.kind===filter)&&(r.kind==='room'||resources.findIndex(s=>s.kind===r.kind)===index)).sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||a.seats-b.seats||a.code.localeCompare(b.code));
  const estimate=resource?workingQuote(resource.hourly_kobo,duration,settings.deposit_percent):null;
  function resetCheck() {setQuote(null);setAvailability(null);setStatus('');}
  async function check(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setQuote(null);setAvailability(null);
    if(!resource) return;
    let interval:{starts_at:string;ends_at:string};
    try {interval=intervalFromSelection(date,hour,duration);validateInterval(interval.starts_at,interval.ends_at,settings);}
    catch(error) {setStatus(error instanceof Error?error.message:'Choose a valid time.');return;}
    if(source!=='live') {setStatus('This is a sample quote. Live availability and reservations are not connected yet.');return;}
    setPending(true);setStatus('Checking your space…');
    try {
      const params=new URLSearchParams({start:interval.starts_at,end:interval.ends_at,resource:selected});
      const [a,q]=await Promise.all([fetch(`/api/availability?${params}`),fetch(`/api/quote?${params}`)]);
      const [available,quoted]=await Promise.all([a.json(),q.json()]);
      if(!a.ok||!q.ok) throw new Error(available.error||quoted.error||'Availability could not be checked.');
      const result=available.availability.find((r:{resource_id:string;available:boolean})=>r.resource_id===selected);
      if(!result) throw new Error('This space is unavailable.');
      setAvailability(result.available);setQuote(quoted.quote);
      setStatus(result.available?'Available for these hours. Your space is reserved when you start checkout.':'This space is occupied or closed for these hours. Try another time.');
    } catch(error) {setStatus(error instanceof Error?error.message:'Could not check availability. Please retry.');}
    finally {setPending(false);}
  }
  const amount=quote||estimate;
  return <>
    <section id="plan" className="visit-planner" aria-labelledby="plan-title"><div className="planner-heading"><div><p className="eyebrow">Make room in your day</p><h2 id="plan-title">Where will you work?</h2></div><p>By the hour · Lagos time (WAT)</p></div><form className="booking-panel compact-planner" onSubmit={check} aria-busy={pending}><div className="planner-fields">
      <div className="planner-space"><label htmlFor="resource">Your space</label><select id="resource" value={selected} disabled={pending||!resources.length} onChange={e=>{setSelected(e.target.value);resetCheck();}}>{resources.map(r=><option key={r.id} value={r.id}>{r.name} · {r.kind==='room'?`${r.seats} seats, whole room`:'1 seat'}</option>)}</select></div>
      <div><label htmlFor="date">Date</label><input id="date" type="date" value={date} disabled={pending} min={initialBookingDate(new Date(Date.now()-86400000))} onChange={e=>{setDate(e.target.value);resetCheck();}} required/></div>
      <div><label htmlFor="start">Start time · WAT</label><select id="start" value={hour} disabled={pending} onChange={e=>{setHour(Number(e.target.value));setDuration(1);resetCheck();}}>{Array.from({length:settings.closes_hour-settings.opens_hour},(_,i)=>settings.opens_hour+i).map(h=><option value={h} key={h}>{String(h).padStart(2,'0')}:00</option>)}</select></div>
      <div><label htmlFor="duration">Duration</label><select id="duration" value={duration} disabled={pending} onChange={e=>{setDuration(Number(e.target.value));resetCheck();}}>{Array.from({length:settings.closes_hour-hour},(_,i)=>i+1).map(d=><option value={d} key={d}>{d} {d===1?'hour':'hours'}</option>)}</select></div>
      <button type="submit" className="button" disabled={pending||!resource}>{pending?'Checking…':source==='live'?'Check availability':'Preview your visit'}<span aria-hidden="true">↗</span></button>
    </div><div className="planner-result"><div className="quote-summary" aria-label={quote?'Live server quote':'Sample price estimate'}><p><span>{quote?'Quoted total':'Estimated total'}</span><strong>{amount?formatMoney(amount.total_kobo):'—'}</strong></p><p><span>{quote?quote.deposit_percent:settings.deposit_percent}% minimum deposit</span><span>{amount?formatMoney(amount.deposit_kobo):'—'}</span></p><p><span>Balance with minimum deposit</span><span>{amount?formatMoney(amount.balance_kobo):'—'}</span></p></div><div className="planner-next"><p className="booking-status" role="status" aria-live="polite" data-available={availability}>{status||(source==='live'?'Check your hours, then review your booking. Checking does not reserve a space.':'Sample quote only. No reservation will be created.')}</p>{source==='live'&&resource?<Link className="text-link" prefetch={false} href={visitDestination({resource:selected,date,hour,duration})}>Continue to booking review <span aria-hidden="true">↗</span></Link>:<p>Live booking review is unavailable.</p>}</div></div><p className="planner-footnote">Minimum, higher or full initial payment available at review. Book up to {settings.horizon_days} days ahead, at least {settings.lead_hours} hour in advance. Demo workspace. Test payments only.</p></form></section>
    <section id="spaces" className="spaces-section" aria-labelledby="spaces-title"><div className="section-heading"><div><p className="eyebrow">Different days. Different spaces.</p><h2 id="spaces-title">Make room for<br/><em>your kind of day.</em></h2></div><p>Find your focus. Share a little energy.<br/>Bring a good idea to the table.</p></div><div className={`connection-note ${source==='unavailable'?'unavailable':''}`} role="status"><span className="status-dot" aria-hidden="true"/>{source==='preview'?'Preview inventory · Sample prices. Live availability is not connected.':source==='live'?'Choose your space. Check your date and hours above.':'Workspace service unavailable · Please try again later.'}</div><div className="filters" aria-label="Filter spaces">{(['all','open_desk','quiet_desk','room'] as const).map(kind=><button key={kind} type="button" aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{kind==='all'?'All spaces':labels[kind]}</button>)}</div><div className="space-grid">{groups.map(r=>{
      const picture=spaceImage(r.kind,r.seats);const isSelected=resource?.kind===r.kind&&(r.kind!=='room'||resource.id===r.id);
      return <article className={`space-card ${isSelected?'space-selected':''}`} key={r.id}><div className="space-image"><Image src={picture.src} alt={picture.alt} width={768} height={512} sizes="(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw"/><span>{r.kind==='room'?`${r.seats} seats · whole room`:`${resources.filter(s=>s.kind===r.kind).length} individual desks`}</span></div><div className="space-card-content"><p className="card-kind">{r.kind==='room'?'A meeting of minds':r.kind==='quiet_desk'?'A little more focus':'A shared rhythm'}</p><h3>{r.kind==='room'?r.name:labels[r.kind]}</h3><p>{r.description}</p><div className="card-bottom"><span><strong>{formatMoney(r.hourly_kobo)}</strong> / hour</span><a href="#plan" aria-disabled={pending} onClick={event=>{if(pending){event.preventDefault();return;}setSelected(r.id);resetCheck();}} aria-label={`Plan a visit for ${r.kind==='room'?r.name:labels[r.kind]}`}>{isSelected?'Selected':'Choose'} <span aria-hidden="true">↗</span></a></div></div></article>;
    })}</div>{!resources.length&&<div className="empty-state"><h3>We can’t show the spaces right now.</h3><p>Please refresh in a moment. No reservation has been created.</p></div>}</section>
  </>;
}
