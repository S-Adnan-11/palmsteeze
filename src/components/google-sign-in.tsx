'use client';
import {useEffect,useRef,useState} from 'react';
import Image from 'next/image';

export function GoogleSignIn({next}:{next:string}) {
  const [pending,setPending]=useState(false);const [slow,setSlow]=useState(false);
  const [error,setError]=useState('');const attempt=useRef(0);const controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const reset=()=>{setPending(false);setSlow(false);};
    window.addEventListener('pageshow',reset);
    return()=>{window.removeEventListener('pageshow',reset);attempt.current++;controller.current?.abort();};
  },[]);
  useEffect(()=>{if(!pending) return;const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[pending]);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending) return;
    const form=new FormData(event.currentTarget);const current=++attempt.current;
    const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),20000);
    setPending(true);setSlow(false);setError('');
    try {
      const response=await fetch('/auth/sign-in',{method:'POST',body:form,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:abort.signal});
      const data=await response.json();if(!response.ok) throw new Error(data.error||'Google sign-in could not be started. Please try again.');
      const url=new URL(data.url);
      if(url.origin!==process.env.NEXT_PUBLIC_SUPABASE_URL||url.pathname!=='/auth/v1/authorize'||url.searchParams.get('provider')!=='google') throw new Error('Google sign-in could not be opened safely. Please reload and try again.');
      if(attempt.current===current) window.location.assign(url.toString());
    } catch(error) {if(attempt.current===current){setError(abort.signal.aborted?'Google sign-in timed out. Check your connection and try again. Your selection is still here.':error instanceof Error?error.message:'Google sign-in could not be opened. Please retry.');setPending(false);}}
    finally {clearTimeout(timeout);}
  }
  return <form action="/auth/sign-in" method="post" aria-busy={pending} onSubmit={submit}>
    <input type="hidden" name="next" value={next}/>
    <button className="google-button" type="submit" disabled={pending}><Image src="/auth/google-g.png" width={20} height={20} alt="" unoptimized/><span>{pending?'Opening Google…':'Continue with Google'}</span></button>
    <p role="status" className="signin-progress">{pending?(slow?'Google is taking longer to open. Reload to retry.':'Opening Google…'):''}</p>
    {error&&<p className="auth-notice signin-error" role="alert">{error}</p>}
  </form>;
}
