import Link from 'next/link';
export function PalmMark({className=''}:{className?:string}){
 return <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 35V19M20 20C5 20 2 9 3 6C13 7 18 12 20 20ZM20 20C35 20 38 9 37 6C27 7 22 12 20 20ZM20 20C10 10 13 3 16 1C21 7 22 13 20 20ZM20 20C30 10 27 3 24 1C19 7 18 13 20 20Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M12 35H28M20 21C11 21 6 27 5 29M20 21C29 21 34 27 35 29" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}
export function Wordmark(){return <Link className="wordmark" href="/" aria-label="PalmSteeze home"><PalmMark className="palm-mark"/>PalmSteeze<span className="brand-dot">.</span></Link>;}
// Public presentation never reads a customer session or private records.
export function PublicHeader(){return <header className="site-header public-header"><Wordmark/><nav aria-label="Main navigation"><Link href="/#spaces">Our spaces</Link><Link href="/portfolio">Behind the build</Link><Link className="nav-cta" href="/preview/admin">Admin preview <span aria-hidden="true">↗</span></Link></nav></header>;}
export function SiteFooter(){return <footer className="site-footer"><Wordmark/><nav aria-label="Footer navigation"><Link href="/preview/admin">Read-only admin preview</Link><Link href="/portfolio">Behind the build</Link><Link href="/#plan">Plan a visit</Link></nav><p>Fictional Lagos workspace · Development sandbox · No real payments</p></footer>;}
