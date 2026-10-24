'use client';
import type {ReactNode} from 'react';
import {Card,CardContent} from '@/components/ui/card';

export function ChoiceCard({name,value,checked,onChange,title,detail,amount,children,disabled=false}: {
  name:string;value:string;checked:boolean;onChange:()=>void;title:string;detail:string;
  amount?:string;children?:ReactNode;disabled?:boolean;
}) {
  return <label className="choice-label"><input className="choice-input" type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled}/>
    <Card className="choice-card">{children}<CardContent><span className="choice-top"><strong>{title}</strong><span className="choice-indicator" aria-hidden="true"/></span><span className="choice-detail">{detail}</span>{amount&&<span className="choice-amount">{amount}</span>}</CardContent></Card>
  </label>;
}
