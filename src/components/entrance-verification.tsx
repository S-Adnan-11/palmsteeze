'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {entranceDestination} from '@/lib/entrance';
import {SecurityChallenge} from './security-challenge';

export function EntranceVerification({destination}:{destination:string}) {
  const [target,setTarget]=useState(destination);
  const [state,setState]=useState<'ready'|'checking'|'navigating'|'error'>('ready');
  const [error,setError]=useState('');
  const [reset,setReset]=useState(0);
  const [navigationFailed,setNavigationFailed]=useState(false);
  const busy=useRef(false);
  useEffect(()=>{
    if(window.location.hash&&!destination.includes('#')) {
      setTarget(entranceDestination(destination+window.location.hash)||destination);
    }
  },[destination]);
  useEffect(()=>{
    if(state!=='navigating')return;
    // Offer a manual link only if this verified page fails to navigate away.
    const timer=window.setTimeout(()=>setNavigationFailed(true),8000);
    // Commit the status and fallback timer before starting document navigation.
    const navigation=window.requestAnimationFrame(()=>{
      try {window.location.replace(target);}catch {setNavigationFailed(true);}
    });
    return()=>{clearTimeout(timer);cancelAnimationFrame(navigation);};
  },[state,target]);
  const verify=useCallback(async(token:string)=>{
    if(!token||busy.current)return;
    busy.current=true;setState('checking');setError('');
    try {
      const signal=AbortSignal.timeout(10000);
      const response=await fetch('/api/verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,next:target}),cache:'no-store',signal});
      const value=await response.json();
      if(!response.ok)throw new Error(value.error||'Verification failed. Try again.');
      const next=entranceDestination(value.destination);
      if(value.verified!==true||!next)throw new Error('Verification could not be confirmed. Try again.');
      const confirmation=await fetch('/api/verification',{cache:'no-store',signal});
      const confirmed=await confirmation.json();
      if(!confirmation.ok||confirmed.verified!==true)throw new Error('Allow first-party cookies, then retry verification.');
      setTarget(next);setState('navigating');
    } catch(error) {
      setError(error instanceof Error&&error.name!=='TimeoutError'?error.message:'Verification is unavailable. Check your connection and retry.');
      setState('error');
    } finally {busy.current=false;}
  },[target]);
  return <section className="entrance-card" aria-busy={state==='checking'}>
    {/* <h1>Welcome to <em>PalmSteeze</em></h1> */}
    <SecurityChallenge action="entrance" onToken={verify} reset={reset} disabled={state==='checking'||state==='navigating'}/>
    <p className="entrance-result" role="status">{state==='checking'?'Confirming verification…':state==='navigating'?(navigationFailed?'Your page did not open. Continue below.':'…'):error}</p>
    {state==='error'&&<button className="button button-secondary" type="button" onClick={()=>{setError('');setState('ready');setReset(value=>value+1);}}>Retry verification</button>}
    {state==='navigating'&&navigationFailed&&<a className="button" href={target}>Continue to PalmSteeze</a>}
    <nav className="entrance-policies" aria-label="Policies without verification"><Link href="/privacy">Privacy</Link><Link href="/cookies">Cookies</Link><Link href="/terms">Demo Terms</Link></nav>
  </section>;
}
