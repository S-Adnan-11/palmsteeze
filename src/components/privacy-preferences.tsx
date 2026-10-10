'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {EntranceRenewal} from '@/components/entrance-renewal';
import {usePathname} from 'next/navigation';
import Link from 'next/link';

const OptionalStorageContext=createContext({allowed:false,ready:false});
let optionalAllowed=false;
export function tabMemoryAllowed(){return optionalAllowed;}
export function useTabMemory(){return useContext(OptionalStorageContext);}
function clearDrafts() {
  try {for(const key of Object.keys(sessionStorage))if(key==='palmsteeze.visit.v1'||key.startsWith('palmsteeze.payment.v1:'))sessionStorage.removeItem(key);}catch{/* Browser site-data controls remain available. */}
}
export function CookieSettingsButton() {
  return <button className="cookie-settings-link" type="button" onClick={event=>window.dispatchEvent(new CustomEvent('palmsteeze-cookie-settings',{detail:event.currentTarget}))}>Cookie settings</button>;
}
export function PrivacyPreferences({children,initialCleared,initialPreference}:{children:React.ReactNode;initialCleared:boolean;initialPreference:{optional:boolean}|null}) {
  const [preference,setPreference]=useState(initialPreference);const [allowed,setAllowed]=useState(initialPreference?.optional===true);
  const [ready,setReady]=useState(false);const [cleared,setCleared]=useState(initialCleared);
  const hadClearance=useRef(initialCleared);if(cleared)hadClearance.current=true;
  const renewed=useCallback(()=>setCleared(true),[]);
  const [managing,setManaging]=useState(false);const [choice,setChoice]=useState(allowed);
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);const closeButton=useRef<HTMLButtonElement>(null);
  const banner=useRef<HTMLElement>(null);const opener=useRef<HTMLElement|null>(null);const path=usePathname();
  const preferenceChannel=useRef<BroadcastChannel|null>(null);
  const preferenceEpoch=useRef(0);const preferenceWrite=useRef(false);const localDenial=useRef(false);
  const visible=cleared&&!preference&&path!=='/verify'&&!managing;
  useEffect(()=>{
    optionalAllowed=allowed;setReady(true);
    if(!allowed)clearDrafts();
    try {sessionStorage.removeItem('palmsteeze.preferences.v1');}catch{/* Legacy preference is ignored. */}
  },[allowed]);
  useEffect(()=>{
    const open=(event:Event)=>{opener.current=(event as CustomEvent).detail instanceof HTMLElement?(event as CustomEvent<HTMLElement>).detail:document.activeElement as HTMLElement;setChoice(optionalAllowed);setError('');setManaging(true);};
    const expired=()=>setCleared(false);
    window.addEventListener('palmsteeze-entrance-required',expired);
    window.addEventListener('palmsteeze-cookie-settings',open);
    return()=>{window.removeEventListener('palmsteeze-cookie-settings',open);window.removeEventListener('palmsteeze-entrance-required',expired);};
  },[]);
  useEffect(()=>{
    if(managing){dialog.current?.showModal();closeButton.current?.focus({preventScroll:true});}else dialog.current?.close();
  },[managing]);
  useEffect(()=>{
    if(!visible||!banner.current)return;
    const measure=()=>document.body.style.setProperty('--cookie-banner-space',`${(banner.current?.getBoundingClientRect().height||0)+40}px`);
    const observer=new ResizeObserver(measure);observer.observe(banner.current);measure();
    return()=>{observer.disconnect();document.body.style.removeProperty('--cookie-banner-space');};
  },[visible]);
  useEffect(()=>{
    const check=()=>{
      const signal=AbortSignal.timeout(5000);
      const epoch=preferenceEpoch.current;
      void fetch('/api/verification',{cache:'no-store',signal}).then(response=>response.json()).then(value=>setCleared(value.verified===true)).catch(()=>{});
      if(preferenceWrite.current)return;
      void fetch('/api/preferences',{cache:'no-store',signal}).then(response=>response.json()).then(value=>{
        if(epoch!==preferenceEpoch.current||preferenceWrite.current)return;
        const next=value.preference&&typeof value.preference.optional==='boolean'?{optional:value.preference.optional}:null;
        if(localDenial.current&&next?.optional)return;
        optionalAllowed=next?.optional===true;if(!optionalAllowed)clearDrafts();setAllowed(optionalAllowed);setPreference(next);
      }).catch(()=>{});
    };
    const onFocus=()=>{if(document.visibilityState==='visible')check();};
    if(typeof BroadcastChannel!=='undefined'){preferenceChannel.current=new BroadcastChannel('palmsteeze-preferences-v2');preferenceChannel.current.onmessage=check;}
    window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
    return()=>{window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);preferenceChannel.current?.close();preferenceChannel.current=null;};
  },[]);
  function close() {
    setManaging(false);
    requestAnimationFrame(()=>{const target=opener.current?.isConnected?opener.current:document.querySelector<HTMLElement>('[data-cookie-manage]');target?.focus({preventScroll:true});});
  }
  function trapDialogFocus(event:React.KeyboardEvent<HTMLDialogElement>) {
    if(event.key!=='Tab')return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')];
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  async function save(optional:boolean) {
    if(preferenceWrite.current)return;preferenceWrite.current=true;preferenceEpoch.current++;setSaving(true);setError('');
    if(!optional){localDenial.current=true;optionalAllowed=false;setAllowed(false);clearDrafts();}
    try {
      const signal=AbortSignal.timeout(8000);
      const response=await fetch('/api/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({optional}),cache:'no-store',signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      const confirmed=await (await fetch('/api/preferences',{cache:'no-store',signal})).json();
      if(confirmed.preference?.optional!==optional)throw new Error('Preference cookie was not saved.');
      localDenial.current=false;optionalAllowed=optional;setAllowed(optional);setPreference({optional});setManaging(false);
      preferenceChannel.current?.postMessage({changed:true});
      requestAnimationFrame(()=>{if(opener.current?.isConnected)opener.current.focus({preventScroll:true});else document.querySelector<HTMLElement>('main a, main button')?.focus({preventScroll:true});});
    } catch {setError('Your preference could not be saved. Optional storage stays off. Retry your choice.');localDenial.current=true;optionalAllowed=false;setAllowed(false);clearDrafts();}
    finally {preferenceEpoch.current++;preferenceWrite.current=false;setSaving(false);}
  }
  return <OptionalStorageContext value={{allowed,ready}}>{children}
    {hadClearance.current&&!cleared&&path!=='/verify'&&<EntranceRenewal onVerified={renewed}/>}
    {visible&&<section ref={banner} className="cookie-banner" aria-label="Cookies and preferences" aria-busy={saving}>
      <p>Necessary cookies keep the site working. Optional storage remembers your choices in this tab. <Link href="/cookies">Details</Link></p>
      <div className="cookie-banner-actions"><button className="button" disabled={saving} onClick={()=>void save(true)}>Accept optional storage</button><button className="button button-secondary" disabled={saving} onClick={()=>void save(false)}>Necessary only</button><button className="text-button" data-cookie-manage type="button" disabled={saving} onClick={event=>{opener.current=event.currentTarget;setChoice(allowed);setError('');setManaging(true);}}>Manage preferences</button></div>
      {error&&<p className="cookie-error" role="alert">{error}</p>}
    </section>}
    <dialog ref={dialog} className="cookie-dialog" aria-labelledby="cookie-settings-title" onKeyDown={trapDialogFocus} onCancel={event=>{event.preventDefault();close();}}>
      <div className="cookie-dialog-heading"><h2 id="cookie-settings-title">Cookie preferences</h2><button ref={closeButton} className="text-button" type="button" aria-label="Close cookie settings" onClick={close}>Close</button></div>
      <div className="cookie-category"><div><h3>Necessary storage</h3><p>Verification, sign-in and your preference.</p></div><span>Always on</span></div>
      <label className="cookie-optional"><input type="checkbox" checked={choice} disabled={saving} onChange={event=>setChoice(event.target.checked)}/><span><strong>Remember booking and payment selections</strong><span>Saves drafts in this tab. Turning this off clears drafts and keeps your current input and bookings.</span></span></label>
      <p className="cookie-lifetime">No analytics or advertising. <Link href="/cookies">Storage details</Link> · <Link href="/privacy">Privacy</Link></p>
      <div className="cookie-dialog-actions"><button className="button" disabled={saving} type="button" onClick={()=>void save(choice)}>{saving?'Saving…':'Save preferences'}</button><button className="button button-secondary" disabled={saving} type="button" onClick={()=>void save(false)}>Necessary only</button></div>
      {error&&<p className="cookie-error" role="alert">{error}</p>}
    </dialog>
  </OptionalStorageContext>;
}
