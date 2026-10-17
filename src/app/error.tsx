'use client';
import Link from 'next/link';
export default function ErrorPage({retry}:{error:Error & {digest?:string};retry:()=>void}) {
  return <main id="main" tabIndex={-1} className="customer-page"><p className="eyebrow">PalmSteeze</p><h1>We couldn’t load this page.</h1><p>Please try again. If you were making a payment, check your visits before starting another checkout.</p><div className="cookie-dialog-actions"><button className="button" onClick={()=>retry()}>Try again</button><Link className="button button-secondary" href="/account">My bookings</Link><Link className="text-link" href="/cookies">Cookies &amp; storage</Link></div></main>;
}
