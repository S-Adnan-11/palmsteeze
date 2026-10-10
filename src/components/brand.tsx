import Image from 'next/image';
import Link from 'next/link';
import {CookieSettingsButton} from './privacy-preferences';

export function PalmMark({className=''}:{className?:string}) {
  return <Image className={className} src="/brand/v2/small-symbol-forest.svg" width={40} height={40} alt="" aria-hidden="true"/>;
}
export function Wordmark({dark=false}:{dark?:boolean}) {
  return <Link className="wordmark" href="/" aria-label="PalmSteeze home"><Image src={`/brand/v2/primary-horizontal-${dark?'ivory':'forest'}.svg`} width={220} height={55} alt="PalmSteeze" priority/></Link>;
}
export function SandboxDisclosure() {
  return <div className="sandbox-strip">Fictional Lagos workspace <span aria-hidden="true">·</span> Test payments only</div>;
}
// Public presentation has no session, private-query or mutation dependency.
export function PublicHeader() {
  return <><SandboxDisclosure/><header className="site-header"><Wordmark/><nav aria-label="Main navigation"><Link href="/#spaces">Spaces</Link><Link href="/#how-it-works">How it works</Link><Link href="/account">My bookings</Link><Link className="nav-cta" href="/#plan">Find a space <span aria-hidden="true">↗</span></Link></nav></header></>;
}
export function SiteFooter() {
  return <footer className="site-footer"><div className="footer-brand"><Wordmark/><p>Room to focus. Space to connect.</p></div><nav aria-label="Footer navigation"><Link href="/#spaces">Spaces</Link><Link href="/account">My bookings</Link><Link href="/portfolio">About this project</Link><Link href="/privacy">Privacy</Link><Link href="/cookies">Cookies</Link><Link href="/terms">Demo Terms</Link><CookieSettingsButton/></nav><p className="footer-disclosure">Fictional Lagos workspace · Test payments only. Architectural images are generated impressions of an imagined venue.</p></footer>;
}
