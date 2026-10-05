import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { getCatalog } from '@/lib/catalog';
import { intervalFromSelection,validateInterval,type Quote } from '@/lib/domain';
import { visitSelection,visitDestination } from '@/lib/auth/destinations';
import { SiteHeader } from '@/components/site-header';
import { CreateCheckout } from '@/components/checkout-actions';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function Review({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key,value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key,v));else if (value !== undefined) search.append(key,value);
  }
  const selection = visitSelection(search);
  const session = await customerSession();
  if (!session) redirect(`/login?message=session-ended&next=${encodeURIComponent(selection ? visitDestination(selection) : '/account')}`);
  const catalog = await getCatalog();const resource = catalog.resources.find((r) => r.id === selection?.resource);
  let quote:Quote|null = null;let available = false;let interval:{starts_at:string;ends_at:string}|null = null;
  if (selection && resource && catalog.source === 'live') {
    try {
      interval = intervalFromSelection(selection.date,selection.hour,selection.duration);
      validateInterval(interval.starts_at,interval.ends_at,catalog.settings);
      const [q,a] = await Promise.all([
        session.client.rpc('quote_resource',{p_resource:selection.resource,p_start:interval.starts_at,p_end:interval.ends_at}),
        session.client.rpc('resource_availability',{p_start:interval.starts_at,p_end:interval.ends_at}),
      ]);
      if (!q.error && !a.error) {quote = q.data as Quote;available = a.data.find((r:{resource_id:string}) => r.resource_id === selection.resource)?.available === true;}
    } catch {quote = null;}
  }
  return <><SiteHeader/><main id="main" className="customer-page"><p className="eyebrow">A fresh check for your visit</p><h1>Review your <em>space.</em></h1>
    {selection && resource && quote && interval ? <><h2>{resource.name}</h2><p data-testid="visit-selection">{selection.date} · {String(selection.hour).padStart(2,'0')}:00 WAT · {selection.duration} {selection.duration === 1 ? 'hour' : 'hours'}</p>
      <p>Availability and price were revalidated after sign-in. Proposed hourly prices apply, with the approved 40% working deposit. Payment uses the Stripe sandbox.</p>
      <CreateCheckout selection={selection} interval={interval} initialQuote={quote} initialAvailable={available}/></>
      : <p className="auth-notice" role="status">This selection is invalid, outside the booking window or no longer available to quote. Choose your space and hours again.</p>}
    <p><Link href="/#plan">Change your selection</Link> · <Link prefetch={false} href="/account">Your visits</Link></p></main></>;
}
