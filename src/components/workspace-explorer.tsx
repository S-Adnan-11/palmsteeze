'use client';
import {useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {visitDestination,visitSelection,editVisitDestination,type VisitSelection} from '@/lib/auth/destinations';
import type {Catalog} from '@/lib/catalog';
import {spaceImage} from '@/lib/space-images';
import {eligibleHours,contiguousDurations,type HourSlot} from '@/lib/booking-options';
import {ChoiceCard} from '@/components/choice-card';
import {BrandSelect} from '@/components/ui/brand-select';
import {BrandDate} from '@/components/ui/brand-date';
import {formatVisitDate} from '@/lib/visit-dates';
import {tabMemoryAllowed,useTabMemory} from '@/components/tab-memory';
import {formatMoney,initialBookingDate,intervalFromSelection,validateInterval,workingQuote,type Quote,type ResourceKind} from '@/lib/domain';
const labels={open_desk:'Open desks',quiet_desk:'Quiet desks',room:'Meeting rooms'};
const savedVisitKey='palmsteeze.visit.v1';

export function WorkspaceExplorer({catalog}:{catalog:Catalog}) {
  const memory=useTabMemory();
  const {resources,settings,source}=catalog;
  const [filter,setFilter]=useState<ResourceKind|'all'>('all');
  const [selection,setSelection]=useState<VisitSelection>({resource:resources.find(r=>r.kind==='open_desk')?.id||resources[0]?.id||'',date:initialBookingDate(),hour:settings.opens_hour,duration:1});
  const [ready,setReady]=useState(false);const [restored,setRestored]=useState('');
  const [status,setStatus]=useState('');const [pending,setPending]=useState(false);
  const [quote,setQuote]=useState<Quote|null>(null);const [availability,setAvailability]=useState<boolean|null>(null);
  const [reload,setReload]=useState(0);
  const [times,setTimes]=useState<{key:string;slots:HourSlot[];pending:boolean;error:string}>({key:'',slots:[],pending:true,error:''});
  const generation=useRef(0);const checking=useRef<AbortController|null>(null);
  const {resource:selected,date,hour,duration}=selection;
  const resource=resources.find(r=>r.id===selected);
  const kindOrder={open_desk:0,quiet_desk:1,room:2};
  const choices=resources.filter((r,index)=>r.kind==='room'||resources.findIndex(s=>s.kind===r.kind)===index).sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||a.seats-b.seats||a.code.localeCompare(b.code));
  const groups=choices.filter(r=>filter==='all'||r.kind===filter);
  const estimate=resource?workingQuote(resource.hourly_kobo,duration,settings.deposit_percent):null;
  const timeKey=selected+'/'+date;
  const timesPending=!ready||times.key!==timeKey||times.pending;
  const slots=times.key===timeKey?times.slots:[];
  const durations=contiguousDurations(hour,slots);
  const validTime=!timesPending&&!times.error&&durations.includes(duration);

  function resetCheck() {generation.current++;checking.current?.abort();setPending(false);setQuote(null);setAvailability(null);setStatus('');}
  function change(values:Partial<VisitSelection>) {resetCheck();setRestored('');setSelection(current=>({...current,...values}));}
  useEffect(()=>{
    if(!memory.ready)return;
    function restore() {
      const params=new URLSearchParams(window.location.search);let saved:VisitSelection|null=null;
      try {saved=visitSelection(params.size?params:new URL(tabMemoryAllowed()?sessionStorage.getItem(savedVisitKey)||'/':'/',window.location.origin).searchParams);} catch { /* Storage is optional. */ }
      if(saved) {
        try {
          const interval=intervalFromSelection(saved.date,saved.hour,saved.duration);validateInterval(interval.starts_at,interval.ends_at,settings);
          if(!resources.some(r=>r.id===saved!.resource)) throw new Error('Removed resource');
          setSelection(saved);setRestored('Selection restored.');
        } catch {setRestored('Choose your space and hours again. The earlier selection is unavailable.');}
      }
      generation.current++;checking.current?.abort();setPending(false);setQuote(null);setAvailability(null);setStatus('');setReady(true);setReload(v=>v+1);
    }
    restore();window.addEventListener('pageshow',restore);
    return()=>{window.removeEventListener('pageshow',restore);checking.current?.abort();};
  },[resources,settings,memory.ready]);
  useEffect(()=>{
    if(!ready||!resource) return;
    if(memory.allowed&&tabMemoryAllowed()) try {sessionStorage.setItem(savedVisitKey,visitDestination(selection));} catch { /* The URL still works when storage is blocked. */ }
    window.history.replaceState(window.history.state,'',editVisitDestination(selection).replace('#plan',window.location.hash));
  },[ready,selection,resource,memory.allowed]);
  useEffect(()=>{
    if(!ready||!selected) return;
    const controller=new AbortController();let active=true;
    setTimes({key:timeKey,slots:[],pending:true,error:''});
    async function load() {
      try {
        if(source==='preview') {setTimes({key:timeKey,slots:eligibleHours(date,settings).map(hour=>({hour,available:true})),pending:false,error:''});return;}
        const response=await fetch('/api/booking-options?'+new URLSearchParams({resource:selected,date}),{signal:controller.signal,cache:'no-store'});
        const data=await response.json();if(!response.ok) throw new Error(data.error||'Available times could not be loaded.');
        if(active) setTimes({key:timeKey,slots:data.slots,pending:false,error:''});
      } catch(error) {if(active) setTimes({key:timeKey,slots:[],pending:false,error:error instanceof Error?error.message:'Available times could not be loaded.'});}
    }
    void load();return()=>{active=false;controller.abort();};
  },[ready,selected,date,timeKey,source,settings,reload]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible'){generation.current++;checking.current?.abort();setPending(false);setQuote(null);setAvailability(null);setStatus('');setReload(v=>v+1);}};
    document.addEventListener('visibilitychange',refresh);
    return()=>document.removeEventListener('visibilitychange',refresh);
  },[]);
  async function check(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();resetCheck();if(!resource||!validTime) return;
    let interval:{starts_at:string;ends_at:string};
    try {interval=intervalFromSelection(date,hour,duration);validateInterval(interval.starts_at,interval.ends_at,settings);}
    catch(error) {setStatus(error instanceof Error?error.message:'Choose a valid time.');return;}
    if(source!=='live') {setStatus('Sample quote only. Reservations are unavailable.');return;}
    const current=++generation.current;const controller=new AbortController();checking.current=controller;
    setPending(true);setStatus('Checking your space…');
    try {
      const params=new URLSearchParams({start:interval.starts_at,end:interval.ends_at,resource:selected});
      const [a,q]=await Promise.all([fetch('/api/availability?'+params,{signal:controller.signal,cache:'no-store'}),fetch('/api/quote?'+params,{signal:controller.signal,cache:'no-store'})]);
      const [available,quoted]=await Promise.all([a.json(),q.json()]);
      if(!a.ok||!q.ok) throw new Error(available.error||quoted.error||'Availability could not be checked.');
      const result=available.availability.find((r:{resource_id:string;available:boolean})=>r.resource_id===selected);
      if(!result) throw new Error('This space is unavailable.');
      if(current!==generation.current) return;
      setAvailability(result.available);setQuote(quoted.quote);
      setStatus(result.available?'Available when checked.':'This space is occupied or closed for these hours. Try another time.');
      if(!result.available) setReload(v=>v+1);
    } catch(error) {if(current===generation.current) setStatus(error instanceof Error?error.message:'Could not check availability. Please retry.');}
    finally {if(current===generation.current) setPending(false);}
  }
  const amount=quote||estimate;
  return <>
    <section id="plan" className="visit-planner refined-planner" aria-labelledby="plan-title"><div className="planner-heading"><div><p className="eyebrow">Make room in your day</p><h2 id="plan-title">What does your day need?</h2></div></div>
      <form onSubmit={check} className="visit-builder">
        <div className="visit-controls"><fieldset className="space-choices"><legend><span className="step-number">01</span> Your kind of space</legend><div className="space-choice-grid">{choices.map(r=>{
          const picture=spaceImage(r.kind,r.seats);const checked=resource?.kind===r.kind&&(r.kind!=='room'||selected===r.id);
          return <ChoiceCard key={r.id} name="space-category" value={r.id} checked={checked} disabled={!ready} onChange={()=>change({resource:r.id})} title={r.kind==='room'?r.name:labels[r.kind]} detail={r.kind==='room'?r.seats+' people · private whole room':r.kind==='quiet_desk'?'1 person · a quieter setting for deep work':'1 person · shared energy, your own desk'} amount={formatMoney(r.hourly_kobo)+' / hour'}><Image src={picture.src} alt="" width={384} height={256} sizes="(max-width: 760px) 50vw, 230px"/></ChoiceCard>;
        })}</div></fieldset>
        <fieldset className="schedule-choices"><legend><span className="step-number">02</span> Your space &amp; hours</legend><div className="schedule-grid">
          <div className="specific-resource">{resource?.kind==='room'?<div className="selected-room" role="group" aria-label="Selected room" data-resource-id={selected}><div><strong>{resource.name}</strong><span>{resource.seats} people · whole room · {formatMoney(resource.hourly_kobo)} / hour</span></div><button className="text-button" type="button" onClick={()=>{const choice=document.querySelector<HTMLInputElement>('.space-choices input:checked');choice?.closest('.choice-label')?.scrollIntoView({block:'center'});choice?.focus({preventScroll:true});}}>Change room <span aria-hidden="true">↑</span></button></div>:<><label htmlFor="resource">Your space</label><BrandSelect id="resource" label="Your space" value={selected} disabled={!ready||!resources.length} onValueChange={value=>change({resource:value})} options={resources.filter(r=>resource?.kind===r.kind).map(r=>({value:r.id,label:r.name,detail:'Individual desk · '+formatMoney(r.hourly_kobo)+' / hour',group:labels[r.kind]}))}/></>}</div>
          <div><label htmlFor="date">Date</label><BrandDate value={date} disabled={!ready} settings={settings} onChange={date=>change({date})}/><p id="date-help" className="field-help">Up to {settings.horizon_days} days ahead</p></div>
          <div><label htmlFor="start">Start time · WAT</label><BrandSelect id="start" value={String(hour)} disabled={timesPending||!slots.length||!!times.error} describedBy="start-help" onValueChange={value=>{
            const next=Number(value);const valid=contiguousDurations(next,slots);change({hour:next,duration:valid.includes(duration)?duration:1});
          }} options={[
            ...(!slots.some(s=>s.hour===hour)?[{value:String(hour),label:String(hour).padStart(2,'0')+':00',detail:timesPending?'Checking times…':'Choose another time',disabled:true,group:'Selected time'}]:[]),
            ...slots.map(s=>({value:String(s.hour),label:String(s.hour).padStart(2,'0')+':00',detail:s.available?'WAT · available when checked':'Unavailable',disabled:!s.available,group:s.hour<12?'Morning · WAT':'Afternoon · WAT'})),
          ]}/><p id="start-help" className="field-help">At least {settings.lead_hours} hour ahead</p></div>
          <div><label htmlFor="duration">Duration</label><BrandSelect id="duration" value={String(duration)} disabled={timesPending||!durations.length||!!times.error} onValueChange={value=>change({duration:Number(value)})} options={[
            ...(!durations.includes(duration)?[{value:String(duration),label:duration+' '+(duration===1?'hour':'hours'),detail:'Choose valid hours again',disabled:true}]:[]),
            ...durations.map(d=>({value:String(d),label:d+' '+(d===1?'hour':'hours'),detail:'Until '+String(hour+d).padStart(2,'0')+':00 WAT',group:d<=3?'1–3 hours':'4 hours or more'})),
          ]}/></div>
        </div><div className="time-feedback" role="status">{timesPending?'Loading available start times…':times.error?<>{times.error} <button type="button" className="text-button" onClick={()=>{resetCheck();setReload(v=>v+1);}}>Retry available times</button></>:!slots.length?'No open hours. Choose another date.':!validTime?'These hours are unavailable. Choose another start time or duration.':source==='live'?'':'Sample opening hours only.'}</div></fieldset>
        </div>
        <aside className="planner-summary" aria-label="Editable visit summary" aria-busy={pending}><p className="eyebrow">Your day, at a glance</p><h3>{resource?.name||'Choose your space'}</h3><p className="summary-atmosphere">{resource?.kind==='room'?resource.seats+' people · whole room':'One desk, all yours.'}</p><dl className="visit-facts"><div><dt>Date</dt><dd>{formatVisitDate(date)}</dd></div><div><dt>Time · WAT</dt><dd>{String(hour).padStart(2,'0')}:00–{String(hour+duration).padStart(2,'0')}:00</dd></div><div><dt>Duration</dt><dd>{duration} {duration===1?'hour':'hours'}</dd></div></dl><div className="quote-summary" data-feedback={pending?'checking':quote?'checked':'estimate'} aria-label={quote?'Current visit quote':'Estimated visit price'}><p><span>{quote?'Quoted total':'Estimated total'}</span><strong>{amount?formatMoney(amount.total_kobo):'—'}</strong></p><p><span>Minimum payable now · {quote?.deposit_percent||settings.deposit_percent}%</span><span>{amount?formatMoney(amount.deposit_kobo):'—'}</span></p><p><span>Remaining with minimum</span><span>{amount?formatMoney(amount.balance_kobo):'—'}</span></p></div>
          
          <button type="submit" className="button" disabled={pending||!resource||!validTime}>{pending?'Checking…':source==='live'?'Check availability':'Preview your visit'}<span aria-hidden="true">↗</span></button>
          {source==='live'&&quote&&availability&&<Link className="button button-secondary" prefetch={false} href={visitDestination(selection)}>Continue to booking review <span aria-hidden="true">↗</span></Link>}
          <p className="booking-status" role="status" data-available={availability}>{status||restored}</p>
        </aside>
      </form>
    </section>
    <section id="spaces" className="spaces-section" aria-labelledby="spaces-title"><div className="section-heading"><div><p className="eyebrow">Different days. Different spaces.</p><h2 id="spaces-title">Make room for<br/><em>your kind of day.</em></h2></div><p>Find your focus. Share a little energy.<br/>Bring a good idea to the table.</p></div><div hidden={source==='live'} className={'connection-note '+(source==='unavailable'?'unavailable':'')} role="status"><span className="status-dot" aria-hidden="true"/>{source==='preview'?'Preview inventory · Sample prices. Live availability is not connected.':source==='live'?'Choose your space. Check your date and hours above.':'Workspace service unavailable · Please try again later.'}</div><div className="filters" aria-label="Filter spaces">{(['all','open_desk','quiet_desk','room'] as const).map(kind=><button key={kind} type="button" aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{kind==='all'?'All spaces':labels[kind]}</button>)}</div><div className="space-grid">{groups.map(r=>{
      const picture=spaceImage(r.kind,r.seats);const isSelected=resource?.kind===r.kind&&(r.kind!=='room'||resource.id===r.id);
      return <article className={'space-card '+(isSelected?'space-selected':'')} key={r.id}><div className="space-image"><Image src={picture.src} alt={picture.alt} width={768} height={512} sizes="(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw"/><span>{r.kind==='room'?r.seats+' seats · whole room':resources.filter(s=>s.kind===r.kind).length+' individual desks'}</span></div><div className="space-card-content"><p className="card-kind">{r.kind==='room'?'A meeting of minds':r.kind==='quiet_desk'?'A little more focus':'A shared rhythm'}</p><h3>{r.kind==='room'?r.name:labels[r.kind]}</h3><p>{r.description}</p><div className="card-bottom"><span><strong>{formatMoney(r.hourly_kobo)}</strong> / hour</span><a href="#plan" onClick={()=>change({resource:r.id})} aria-label={'Plan a visit for '+(r.kind==='room'?r.name:labels[r.kind])}>{isSelected?'Selected':'Choose'} <span aria-hidden="true">↗</span></a></div></div></article>;
    })}</div>{!resources.length&&<div className="empty-state"><h3>We can’t show the spaces right now.</h3><p>Please refresh in a moment.</p></div>}</section>
  </>;
}
