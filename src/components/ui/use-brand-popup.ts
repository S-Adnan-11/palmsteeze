'use client';
import {useEffect,useRef,type RefObject} from 'react';

export const brandPopupPosition={side:'bottom',align:'start',sideOffset:8,collisionPadding:12,sticky:'always',avoidCollisions:true} as const;

// Shared modal popup boundary. Restore inert before returning focus, and never
// scroll the surrounding document to focus a trigger during dismissal.
export function useBrandPopup(open:boolean,content:HTMLElement|null,trigger:RefObject<HTMLButtonElement|null>) {
  const restore=useRef<(()=>void)|null>(null);
  useEffect(()=>{
    if(!open||!content)return;
    const background=[...document.body.children].filter((node):node is HTMLElement=>node instanceof HTMLElement&&!node.contains(content)&&!node.hasAttribute('data-radix-focus-guard')&&!node.inert);
    background.forEach(node=>{node.inert=true;});
    const release=()=>{background.forEach(node=>{node.inert=false;});restore.current=null;};
    restore.current=release;return release;
  },[open,content]);
  return {
    release:()=>restore.current?.(),
    onCloseAutoFocus:(event:Event)=>{event.preventDefault();restore.current?.();trigger.current?.focus({preventScroll:true});},
  };
}
