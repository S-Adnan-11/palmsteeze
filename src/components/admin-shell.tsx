'use client';
import type {ReactNode} from 'react';
import {useEffect,useRef} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Wordmark} from './brand';
import {UiIcon} from './ui-icon';
export const adminSections=[['Overview','/admin','overview'],['Bookings','/admin/bookings','bookings'],['Spaces','/admin/spaces','spaces'],['Availability','/admin/availability','availability'],['Refunds & recovery','/admin/recovery','recovery'],['Audit','/admin/audit','audit']] as const;
export type AdminSection=typeof adminSections[number][0];
export function AdminShell({children,preview=false,section,onSection}:{children:ReactNode;preview?:boolean;section?:AdminSection;onSection?:(section:AdminSection)=>void}) {
  const path=usePathname();
  const active=section||adminSections.find(([,href])=>href==='/admin'?path==='/admin':path.startsWith(href))?.[0]||'Overview';
  const main=useRef<HTMLElement>(null);const previous=useRef(active);
  useEffect(()=>{if(preview&&previous.current!==active) main.current?.focus({preventScroll:true});previous.current=active;},[active,preview]);
  return <div className={`workspace-shell ${preview?'workspace-preview':''}`}><aside className="workspace-sidebar"><Wordmark dark/><p className="sidebar-kicker">Workspace management</p><nav aria-label={preview?'Synthetic preview views':'Administration navigation'}>{adminSections.map(([label,href,icon])=>preview?<button key={href} type="button" aria-pressed={active===label} onClick={()=>onSection?.(label)}><UiIcon name={icon}/>{label}</button>:<Link key={href} href={href} prefetch={false} aria-current={active===label?'page':undefined}><UiIcon name={icon}/>{label}</Link>)}</nav><div className="sidebar-note"><span className="sidebar-indicator"/><strong>{preview?'Synthetic · Read-only':'Development sandbox'}</strong><p>{preview?'Illustrative records only. No real accounts or financial actions.':'Fictional venue. Test payments only.'}</p><Link href={preview?'/portfolio':'/account'}>{preview?'About this project':'Back to my bookings'} <span aria-hidden="true">↗</span></Link></div></aside><div className="workspace-body"><header className="workspace-topbar"><span>Workspace <span aria-hidden="true">/</span> <strong>{active}</strong></span><span className="environment-label">{preview?'Synthetic · Read-only':'Sandbox · Assigned admin'}</span></header><main ref={main} id="main" tabIndex={-1} className="admin-page"><div className="admin-view" key={active}>{children}</div></main><footer className="workspace-footer">PalmSteeze Workspaces <span>Fictional venue · Test payments only</span><nav aria-label="Footer navigation"><Link href="/privacy">Privacy</Link><Link href="/cookies">Cookies</Link><Link href="/terms">Demo Terms</Link></nav></footer></div></div>;
}
