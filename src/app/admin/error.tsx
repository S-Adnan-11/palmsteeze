'use client';
export default function AdminError({retry}:{retry:()=>void}) {
 return <section className="admin-card"><h1>Administration is temporarily <em>unavailable.</em></h1><p>Refresh to check results before retrying an action.</p><button className="button" onClick={retry}>Try again</button></section>;
}
