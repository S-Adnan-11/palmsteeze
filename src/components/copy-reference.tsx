'use client';
import {useState} from 'react';
export function CopyReference({value}:{value:string}) {
  const [message,setMessage]=useState('');
  return <div className="copy-reference"><code>{value}</code><button type="button" className="button button-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(value);setMessage('Reference copied.');}catch{setMessage('Select the reference to copy it.');}}}>Copy reference</button><span role="status">{message}</span></div>;
}
