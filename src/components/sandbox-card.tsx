'use client';
import {useState} from 'react';
import Image from 'next/image';
import {checkoutTestCard,formatCardNumber} from '@/lib/sandbox-cards';
import {UiIcon} from '@/components/ui-icon';

export function SandboxCard({bookingId,createdAt,displayName,companion=false}:{bookingId:string;createdAt:string;displayName:string;companion?:boolean}) {
  const card=checkoutTestCard(bookingId,createdAt,displayName);
  const [status,setStatus]=useState('');
  async function copy(label:string,value:string) {
    try {await navigator.clipboard.writeText(value);setStatus(label+' copied.');}
    catch {setStatus('Select '+label.toLowerCase()+' to copy it manually.');}
  }
  function openCompanion() {
    const popup=window.open('about:blank','_blank','popup,width=460,height=720');
    if(!popup){setStatus('Window blocked. Copy from the card here.');return;}
    popup.opener=null;
    popup.location.replace(`/booking/${encodeURIComponent(bookingId)}/test-card`);
    setStatus('Companion opened. Switch between it and Stripe to copy details.');
  }
  const fields=[{label:'Card number',value:formatCardNumber(card),copy:card.number,key:'number'},{label:'Expiry',value:card.expiry,copy:card.expiry,key:'expiry'},{label:'CVC',value:card.cvc,copy:card.cvc,key:'cvc'},{label:'Cardholder',value:card.name,copy:card.name,key:'name'}];
  return <section className="sandbox-card-helper" aria-label="Sandbox test card">
    <div className="sandbox-card-heading"><h2>Your test card</h2><span>Sandbox only</span></div>
    <p className="sandbox-card-intro">Copy these details into Stripe. No real card needed.</p>
    <div className="sandbox-card-face"><div className="sandbox-card-brand"><Image src="/brand/v2/primary-horizontal-ivory.svg" width={176} height={44} alt="PalmSteeze"/><span>{card.brand}</span></div>
      <dl>{fields.map(field=><div className={'sandbox-card-field sandbox-card-'+field.key} key={field.key}><dt>{field.label}</dt><dd><span data-card-field={field.key}>{field.value}</span></dd></div>)}</dl>
    </div>
    <div className="sandbox-card-copy" aria-label="Copy test details">{fields.map(field=><button key={field.key} type="button" aria-label={'Copy '+field.label.toLowerCase()} onClick={()=>void copy(field.label,field.copy)}><UiIcon name="copy"/>{({number:'Number',expiry:'Expiry',cvc:'CVC',name:'Name'})[field.key]}</button>)}</div>
    <p className="sandbox-card-caption">For Stripe test payments only.</p>
    {!companion&&<button className="text-button sandbox-companion-button" type="button" onClick={openCompanion}>Open card companion ↗</button>}
    {companion&&<p className="sandbox-card-intro">Switch back to Stripe when ready. This window does not stay on top.</p>}
    <p className="sandbox-card-status" role="status">{status}</p>
  </section>;
}
