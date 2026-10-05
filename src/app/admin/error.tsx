'use client';
export default function AdminError({reset}:{reset:()=>void}) {
 return <section className="admin-card"><h1>Administration is temporarily <em>unavailable.</em></h1><p>Refresh to verify stored results. Do not assume that a payment, refund or resource change succeeded.</p><button className="button" onClick={reset}>Try again</button></section>;
}
