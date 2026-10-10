'use client';
import {useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import Link from 'next/link';
import type {TurnstileAction} from '@/lib/turnstile-config';

type Turnstile={render:(node:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void;reset:(id:string)=>void;execute:(id:string)=>void};
declare global {interface Window {turnstile?:Turnstile;palmsteezeTurnstileLoaded?:()=>void}}
let loading:Promise<void>|undefined;
function loadScript() {
  if(window.turnstile)return Promise.resolve();
  if(loading)return loading;
  loading=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=palmsteezeTurnstileLoaded';script.async=true;script.defer=true;
    const timer=window.setTimeout(failed,15000);
    function failed(){clearTimeout(timer);script.remove();delete window.palmsteezeTurnstileLoaded;loading=undefined;reject(new Error('Verification could not load. Allow challenges.cloudflare.com, then retry.'));}
    window.palmsteezeTurnstileLoaded=()=>{clearTimeout(timer);delete window.palmsteezeTurnstileLoaded;resolve();};
    script.onerror=failed;document.head.appendChild(script);
  });
  return loading;
}
export type SecurityChallengeHandle={verify:()=>Promise<string>};
type Props={action:TurnstileAction;onToken?:(token:string)=>void;reset?:number;disabled?:boolean;ref?:Ref<SecurityChallengeHandle>};

export function SecurityChallenge({action,onToken,reset=0,disabled=false,ref}:Props) {
  const node=useRef<HTMLDivElement>(null);
  const notify=useRef(onToken);
  useEffect(()=>{notify.current=onToken;},[onToken]);
  const begin=useRef<(()=>Promise<void>)|null>(null);
  const request=useRef<{promise:Promise<string>;resolve:(token:string)=>void;reject:(error:Error)=>void}|null>(null);
  const [state,setState]=useState(action==='entrance'?'loading':'idle');
  const [message,setMessage]=useState(action==='entrance'?'Loading verification…':'');
  const [code,setCode]=useState('');
  const entrance=action==='entrance';const statusId=entrance?'entrance-security-status':'security-status';
  useImperativeHandle(ref,()=>({verify:()=>{
    if(request.current)return request.current.promise;
    let resolve!:(token:string)=>void;let reject!:(error:Error)=>void;
    const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
    request.current={promise,resolve,reject};
    void begin.current?.();
    return promise;
  }}),[]);
  useEffect(()=>{
    let active=true;let widget:string|undefined;let watchdog:number|undefined;
    const update=(value:string,text:string,errorCode='')=>{if(active){setState(value);setMessage(text);setCode(errorCode);}};
    const fail=(text:string,errorCode='')=>{
      clearTimeout(watchdog);if(!active)return;
      notify.current?.('');update('error',text,errorCode);
      request.current?.reject(new Error(text));request.current=null;
    };
    const initialise=async()=>{
      const sitekey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      if(!sitekey||/your_|placeholder/i.test(sitekey))throw new Error('Verification is unavailable. Try again later.');
      await loadScript();
      if(!active||!node.current||!window.turnstile)return;
      if(widget)return;
      widget=window.turnstile.render(node.current,{sitekey,action,theme:'light',size:'flexible',
        appearance:entrance?'always':'interaction-only',execution:entrance?'render':'execute',
        'response-field':false,retry:'never','refresh-expired':'manual','refresh-timeout':'manual',
        'before-interactive-callback':()=>update('challenge','Complete the security check.'),
        callback:(token:string)=>{
          clearTimeout(watchdog);if(!active)return;
          update(entrance?'complete':'idle',entrance?'':'Security check complete.');
          notify.current?.(token);request.current?.resolve(token);request.current=null;
        },
        'error-callback':(value:string)=>{
          const safeCode=/^\d{6}$/.test(String(value))?String(value):'';
          fail(safeCode==='110200'?'Verification is unavailable at this address. Contact the project owner.':'Verification failed. Check your connection and retry.',safeCode);
        },
        'expired-callback':()=>{if(entrance||request.current)fail('Verification expired. Retry the check.');else {notify.current?.('');update('idle','');}},
        'timeout-callback':()=>fail('Verification timed out. Retry the check.'),
        'unsupported-callback':()=>fail('Try verification in an updated browser.'),
      });
    };
    const start=async()=>{
      update('loading','Checking security…');
      try {
        // No idle reservation challenge, focus listener, render dependency or
        // automatic refresh loop. Reset only for an explicit new attempt.
        if(widget)window.turnstile?.reset(widget);
        watchdog=window.setTimeout(()=>fail('Verification is taking too long. Check your connection and retry.'),45000);
        await initialise();
        if(active&&!entrance&&widget)window.turnstile?.execute(widget);
      } catch(error){fail(error instanceof Error?error.message:'Verification could not start. Retry.');}
    };
    begin.current=start;
    if(entrance)void start();
    return()=>{
      active=false;begin.current=null;clearTimeout(watchdog);
      request.current?.reject(new Error('Verification was interrupted. Retry.'));request.current=null;
      if(widget)window.turnstile?.remove(widget);
    };
  },[action,entrance]);
  const lastReset=useRef(reset);
  useEffect(()=>{if(lastReset.current!==reset){lastReset.current=reset;void begin.current?.();}},[reset]);
  return <section className="reservation-security" aria-label={entrance?'Entrance verification':'Reservation security'} aria-describedby={statusId} data-state={state} data-error-code={code} data-action={action}>
    <div className="security-widget" ref={node}/><p id={statusId} role="status">{message}</p>
    {state==='error'&&<div className="security-help">{entrance&&<button className="text-button" type="button" disabled={disabled} onClick={()=>void begin.current?.()}>Retry security check</button>}<Link href="/cookies#services">Verification help</Link></div>}
    <noscript>JavaScript is needed for verification. Privacy, Cookies and Demo Terms remain available.</noscript>
  </section>;
}
