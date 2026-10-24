'use client';
/* eslint-disable @next/next/no-img-element -- Restricted direct profile request; no Next image proxy or hydration retry. */
import {useEffect,useRef,useState} from 'react';
import type {AccountProfile} from '@/lib/account-profile';

export function AccountProfileHeader({profile}:{profile:AccountProfile}) {
  const [failed,setFailed]=useState<string|null>(null);
  const image=useRef<HTMLImageElement>(null);
  useEffect(()=>{
    // A server-rendered image can fail before hydration attaches onError.
    if(image.current?.complete&&image.current.naturalWidth===0)setFailed(profile.avatar);
  },[profile.avatar]);
  return <div className="account-profile"><span className="account-avatar" aria-hidden="true">
    {profile.avatar&&failed!==profile.avatar?<img ref={image} src={profile.avatar} alt="" width={48} height={48} crossOrigin="anonymous" referrerPolicy="no-referrer" onError={()=>setFailed(profile.avatar)}/>:profile.initials}
    </span><div><p className="account-name">{profile.name}</p><p className="account-email" data-testid="customer-identity">{profile.email||'Signed in'}</p></div></div>;
}
