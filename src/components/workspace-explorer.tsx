'use client';
import { useState } from 'react';
import Link from 'next/link';
import { visitDestination } from '@/lib/auth/destinations';
import type { Catalog } from '@/lib/catalog';
import { formatMoney, initialBookingDate, intervalFromSelection, validateInterval, workingQuote, type Quote, type ResourceKind } from '@/lib/domain';

const labels = {open_desk:'Open desks',quiet_desk:'Quiet desks',room:'Meeting rooms'};
function SpaceArt({kind,seats}: {kind:ResourceKind;seats:number}) {
  return <svg viewBox="0 0 360 180" role="img" aria-label={kind === 'room' ? `Illustration of a whole meeting room for ${seats}` : `Illustration of ${labels[kind].toLowerCase()}`}>
    <rect width="360" height="180" fill={kind === 'quiet_desk' ? '#d1dbc9' : kind === 'room' ? '#e1d9c9' : '#dedfcf'}/>
    <path d="M32 132V60a42 42 0 0184 0v72Z" fill="#f6f1e2"/><path d="M41 132V61a33 33 0 0166 0v71Z" fill="#a6bca3"/>
    <path d="M73 32V132M42 85H106" stroke="#e9e9d5" strokeWidth="4"/><path d="M0 146H360V180H0Z" fill="#bbae95"/>
    <path d={kind === 'room' ? 'M110 119L267 110 300 134 133 143Z' : 'M126 114H281V125H126Z'} fill="#8f7453"/>
    <path d="M142 132V165M267 124V165" stroke="#5f503f" strokeWidth="5"/>
    <rect x="180" y="87" width="46" height="28" rx="2" fill="#405346"/><rect x="185" y="91" width="36" height="20" fill="#dce3cd"/>
    <path d="M182 145H232V167H182Z" fill="#3d6650"/><path d="M190 159V176M224 159V176" stroke="#3e5042" strokeWidth="4"/>
    {kind === 'room' && <><rect x="113" y="145" width="34" height="22" rx="6" fill="#3d6650"/><rect x="266" y="132" width="34" height="22" rx="6" fill="#3d6650"/></>}
    <path d="M319 133V77M319 94q-21-35-37-24q8 25 37 24M319 105q26-35 37-22q-9 23-37 22M319 79q-7-35 8-39q10 27-8 39" stroke="#496c4d" strokeWidth="3" fill="#496c4d"/>
    <path d="M305 134H334L330 165H311Z" fill="#e4d4b4"/>
  </svg>;
}

export function WorkspaceExplorer({catalog}: {catalog:Catalog}) {
  const {resources,settings,source} = catalog;
  const [filter,setFilter] = useState<ResourceKind|'all'>('all');
  const [selected,setSelected] = useState(resources.find(r=>r.kind==='open_desk')?.id || resources[0]?.id || '');
  const [date,setDate] = useState(initialBookingDate);
  const [hour,setHour] = useState(settings.opens_hour);
  const [duration,setDuration] = useState(1);
  const [status,setStatus] = useState('');
  const [pending,setPending] = useState(false);
  const [quote,setQuote] = useState<Quote|null>(null);
  const [availability,setAvailability] = useState<boolean|null>(null);
  const resource = resources.find((r) => r.id === selected);
  const kindOrder={open_desk:0,quiet_desk:1,room:2};
  const groups = resources.filter((r) => (filter === 'all' || r.kind === filter) && (r.kind === 'room' || r.code.endsWith('-01'))).sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||a.seats-b.seats||a.code.localeCompare(b.code));
  const estimate = resource ? workingQuote(resource.hourly_kobo,duration,settings.deposit_percent) : null;
  function resetCheck() { setQuote(null);setAvailability(null);setStatus(''); }
  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setQuote(null);setAvailability(null);
    if (!resource) return;
    let interval: {starts_at:string;ends_at:string};
    try { interval = intervalFromSelection(date,hour,duration);validateInterval(interval.starts_at,interval.ends_at,settings); }
    catch(error) { setStatus(error instanceof Error ? error.message : 'Choose a valid time.');return; }
    if (source !== 'live') {setStatus('This is a sample quote. Live availability and reservations are not connected yet.');return;}
    setPending(true);setStatus('Checking your space…');
    try {
      const params = new URLSearchParams({start:interval.starts_at,end:interval.ends_at,resource:selected});
      const [a,q] = await Promise.all([fetch(`/api/availability?${params}`),fetch(`/api/quote?${params}`)]);
      const [available,quoted] = await Promise.all([a.json(),q.json()]);
      if (!a.ok || !q.ok) throw new Error(available.error || quoted.error || 'Availability could not be checked.');
      const result = available.availability.find((r: {resource_id:string;available:boolean}) => r.resource_id === selected);
      if (!result) throw new Error('This space is unavailable.');
      setAvailability(result.available);setQuote(quoted.quote);
      setStatus(result.available ? 'Available for these hours. Availability is rechecked when a hold is created.' : 'This space is occupied or closed for these hours. Try another time.');
    } catch(error) {setStatus(error instanceof Error ? error.message : 'Could not check availability. Please retry.');}
    finally {setPending(false);}
  }
  const amount = quote || estimate;
  return <>
    <section id="spaces" className="spaces-section" aria-labelledby="spaces-title">
      <div className="section-heading"><div><p className="eyebrow">Room for your next good idea</p><h2 id="spaces-title">A place for <em>every pace.</em></h2></div><p>Solo focus or a meeting of minds.<br/>Find a space that fits your day.</p></div>
      <div className={`connection-note ${source === 'unavailable' ? 'unavailable' : ''}`} role="status">
        <span className="status-dot" aria-hidden="true"/>{source === 'preview' ? 'Preview inventory · Sample prices. Live availability is not connected.' : source === 'live' ? 'Connected inventory · Check your date and time for live availability.' : 'Workspace service unavailable · Please try again later.'}
      </div>
      <div className="filters" aria-label="Filter spaces">{(['all','open_desk','quiet_desk','room'] as const).map((kind) => <button key={kind} type="button" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kind === 'all' ? 'All spaces' : labels[kind]}</button>)}</div>
      <div className="space-grid">{groups.map((r) => <article className="space-card" key={r.id}><div className="space-image"><SpaceArt kind={r.kind} seats={r.seats}/><span>{r.kind === 'room' ? `${r.seats} seats · whole room` : `${resources.filter((s) => s.kind === r.kind).length} individual desks`}</span></div>
        <div className="space-card-content"><p className="card-kind">{r.kind === 'room' ? 'A room of your own' : r.kind === 'quiet_desk' ? 'Deep work, made easy' : 'A little shared energy'}</p><h3>{r.kind === 'room' ? r.name : labels[r.kind]}</h3><p>{r.description}</p><div className="card-bottom"><span><strong>{formatMoney(r.hourly_kobo)}</strong> / hour</span><a href="#plan" onClick={(event) => {if(pending){event.preventDefault();return;}setSelected(r.id);resetCheck();}} aria-label={`Plan a visit for ${r.kind === 'room' ? r.name : labels[r.kind]}`}>Choose <span aria-hidden="true">↗</span></a></div></div>
      </article>)}</div>
    </section>
    <section id="plan" className="plan-section" aria-labelledby="plan-title"><div className="plan-copy"><p className="eyebrow">Make room in your day</p><h2 id="plan-title">Your workday,<br/><em>your way.</em></h2><p>Pick a desk or a whole room, then choose your hours. All times are Lagos time (WAT).</p><div className="hours-note"><span aria-hidden="true">◷</span><div><strong>Come for an hour. Stay in your flow.</strong><p>Book up to {settings.horizon_days} days ahead, at least {settings.lead_hours} hour in advance.</p></div></div><p className="proposal-note">Fictional venue. {settings.defaults_proposed ? 'Hours and rates are proposed working defaults; the 40% working deposit is owner-approved.' : 'Current venue settings apply to new quotes.'} {catalog.source==='live' ? 'Checkout uses sandbox cards only; no real funds.':'Preview only; no payments are collected.'}</p></div>
      <form className="booking-panel" onSubmit={check}>
        <div className="panel-title"><h3>Plan your visit</h3><span>By the hour</span></div>
        <label htmlFor="resource">Your space</label><select id="resource" value={selected} disabled={pending || !resources.length} onChange={(e) => {setSelected(e.target.value);resetCheck();}}>{resources.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.kind === 'room' ? `${r.seats} seats, whole room` : '1 seat'}</option>)}</select>
        <label htmlFor="date">Date</label><input id="date" type="date" value={date} disabled={pending} min={initialBookingDate(new Date(Date.now()-86400000))} onChange={(e) => {setDate(e.target.value);resetCheck();}} required/>
        <div className="time-fields"><div><label htmlFor="start">Start time · WAT</label><select id="start" value={hour} disabled={pending} onChange={(e) => {setHour(Number(e.target.value));setDuration(1);resetCheck();}}>{Array.from({length:settings.closes_hour-settings.opens_hour},(_,i) => settings.opens_hour+i).map((h) => <option value={h} key={h}>{String(h).padStart(2,'0')}:00</option>)}</select></div><div><label htmlFor="duration">Duration</label><select id="duration" value={duration} disabled={pending} onChange={(e) => {setDuration(Number(e.target.value));resetCheck();}}>{Array.from({length:settings.closes_hour-hour},(_,i) => i+1).map((d) => <option value={d} key={d}>{d} {d === 1 ? 'hour' : 'hours'}</option>)}</select></div></div>
        <div className="quote-summary" aria-label={quote ? 'Live server quote' : 'Sample price estimate'}><p><span>{quote ? 'Quoted total' : 'Estimated total'}</span><strong>{amount ? formatMoney(amount.total_kobo) : '—'}</strong></p><p><span>{quote ? quote.deposit_percent : settings.deposit_percent}% deposit</span><span>{amount ? formatMoney(amount.deposit_kobo) : '—'}</span></p><p><span>Balance at venue</span><span>{amount ? formatMoney(amount.balance_kobo) : '—'}</span></p></div>
        <button type="submit" className="button" disabled={pending || !resource}>{pending ? 'Checking…' : source === 'live' ? 'Check availability' : 'Preview your visit'}<span aria-hidden="true">↗</span></button>
        <p className="booking-status" role="status" aria-live="polite" data-available={availability}>{status || (source === 'live' ? 'Checking availability does not reserve the space.' : 'Sample quote only. No reservation will be created.')}</p>
        <p className="signin-note">{source === 'live' && resource ? <Link prefetch={false} href={visitDestination({resource:selected,date,hour,duration})}>Continue to booking review</Link> : 'Live booking review is unavailable.'} Sign-in is required before a temporary hold. No payments are collected here.</p>
      </form>
    </section>
  </>;
}
