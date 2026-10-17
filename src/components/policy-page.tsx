import Link from 'next/link';
import { PublicHeader,SiteFooter } from '@/components/brand';

export function PolicyPage({title,intro,sections,children}:{title:string;intro:string;sections:{id:string;title:string}[];children:React.ReactNode}) {
  return <><PublicHeader/><main id="main" tabIndex={-1} className="policy-page"><p className="eyebrow">PalmSteeze · Your information</p><h1>{title}</h1><p className="policy-intro">{intro}</p><p className="policy-date">Effective <time dateTime="2026-10-17">17 October 2026</time> · Personal portfolio demo</p>
    <nav className="policy-tabs" aria-label="Policy pages"><Link href="/privacy" aria-current={title==='Privacy'?'page':undefined}>Privacy</Link><Link href="/cookies" aria-current={title==='Cookies & storage'?'page':undefined}>Cookies &amp; storage</Link><Link href="/terms" aria-current={title==='Demo Terms'?'page':undefined}>Demo Terms</Link></nav>
    <div className="policy-layout"><nav className="policy-contents" aria-label="On this page"><p>On this page</p><ol>{sections.map(section=><li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav><article className="policy-copy">{children}<p><Link className="text-link" href="/#plan">Return to planning your visit ↗</Link></p></article></div>
  </main><SiteFooter/></>;
}
