'use client';
import {useTransition} from 'react';
import {useRouter} from 'next/navigation';
export function JourneyRetry({label='Try again'}:{label?:string}) {
  const router=useRouter();const [pending,start]=useTransition();
  return <div className="journey-retry" aria-busy={pending}><button type="button" className="button button-secondary" disabled={pending} onClick={()=>start(()=>router.refresh())}>{pending?'Checking…':label}</button><span role="status">{pending?'Checking your saved selection and status…':''}</span></div>;
}
