import Link from 'next/link';
import {PublicHeader,SiteFooter} from '@/components/brand';
export default function NotFound() {
  return <><PublicHeader/><main id="main" tabIndex={-1} className="customer-page"><p className="eyebrow">PalmSteeze · 404</p><h1>This page isn’t here.</h1><p>Return to planning your visit or open your bookings.</p><div className="cookie-dialog-actions"><Link className="button" href="/">Find a space</Link><Link className="button button-secondary" href="/account">My bookings</Link></div></main><SiteFooter/></>;
}
