'use client';
import {useCallback,useState} from 'react';
import {SecurityChallenge} from '@/components/security-challenge';

// Renew the same entrance boundary in place, retaining necessary-only input.
// This cookie never replaces the independent reserve action/capability.
export function EntranceRenewal({onVerified}:{onVerified:()=>void}) {
  const [error,setError]=useState('');const [checking,setChecking]=useState(false);const [reset,setReset]=useState(0);
  const verify=useCallback(async(token:string)=>{
    if(!token)return;
    setChecking(true);setError('');
    try {
      const signal=AbortSignal.timeout(10000);
      const response=await fetch('/api/verification',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal,body:JSON.stringify({token,next:window.location.pathname+window.location.search})});
      if(!response.ok)throw new Error('Verification could not be renewed. Retry.');
      const confirmation=await fetch('/api/verification',{cache:'no-store',signal});
      if(!confirmation.ok||(await confirmation.json()).verified!==true)throw new Error('Allow first-party cookies, then retry.');
      onVerified();
    } catch(error){setError(error instanceof Error?error.message:'Verification could not be renewed. Retry.');}
    finally {setChecking(false);}
  },[onVerified]);
  return <aside className="verification-renewal" aria-label="Renew entrance verification" aria-busy={checking}><p>Verification expired. Verify here to continue.</p><SecurityChallenge action="entrance" onToken={verify} reset={reset} disabled={checking}/>{error&&<><p role="status">{error}</p><button type="button" className="text-button" onClick={()=>setReset(value=>value+1)}>Retry verification</button></>}</aside>;
}
