import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerSession } from '@/lib/supabase/server';
import { getCatalog } from '@/lib/catalog';
import { intervalFromSelection,validateInterval,type Quote } from '@/lib/domain';
import { visitSelection,visitDestination,editVisitDestination } from '@/lib/auth/destinations';
import { SiteHeader } from '@/components/site-header';
import { CreateCheckout } from '@/components/checkout-actions';
import Image from 'next/image';
import {SiteFooter} from '@/components/brand';
import {spaceImage} from '@/lib/space-images';
import {formatVisitDate} from '@/lib/visit-dates';
import {JourneyRetry} from '@/components/journey-retry';
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
  if (!session) redirect(`/login?message=booking-required&next=${encodeURIComponent(selection ? visitDestination(selection) : '/account')}`);
  const catalog = await getCatalog();const resource = catalog.resources.find((r) => r.id === selection?.resource);
  let quote:Quote|null = null;let available = false;let interval:{starts_at:string;ends_at:string}|null = null;
  let unavailable=catalog.source!=='live';
  if (selection && resource && catalog.source === 'live') {
    try {
      interval = intervalFromSelection(selection.date,selection.hour,selection.duration);
      validateInterval(interval.starts_at,interval.ends_at,catalog.settings);
    } catch {interval=null;}
    if(interval) try {
      const [q,a] = await Promise.all([
        session.client.rpc('quote_resource',{p_resource:selection.resource,p_start:interval.starts_at,p_end:interval.ends_at}),
        session.client.rpc('resource_availability',{p_start:interval.starts_at,p_end:interval.ends_at}),
      ]);
      if (!q.error && !a.error) {quote = q.data as Quote;available = a.data.find((r:{resource_id:string}) => r.resource_id === selection.resource)?.available === true;}
      else unavailable=true;
    } catch {quote = null;unavailable=true;}
  }
  const image=resource?spaceImage(resource.kind,resource.seats):null;
  return <><SiteHeader/><main id="main" tabIndex={-1} className="customer-page"><div className="review-step"><span>01 · Choose a space</span><span aria-hidden="true">→</span><strong>02 · Review your visit</strong><span aria-hidden="true">→</span><span>03 · Test payment</span></div><p className="eyebrow">A little room for your day</p><h1>Review your <em>space.</em></h1>
    {selection && resource && quote && interval && image ? <div className="review-layout"><section className="review-space"><Image src={image.src} alt={image.alt} width={768} height={512}/><div className="review-space-content"><p className="eyebrow">{resource.kind==='room'?`${resource.seats} seats · whole room`:'An individual desk'}</p><h2>{resource.name}</h2><p data-testid="visit-selection">{formatVisitDate(selection.date)} · {String(selection.hour).padStart(2,'0')}:00–{String(selection.hour+selection.duration).padStart(2,'0')}:00 WAT · {selection.duration} {selection.duration === 1 ? 'hour' : 'hours'}</p><p>{resource.description}</p><Link className="text-link" href={selection?editVisitDestination(selection):'/#plan'}>Edit space, date or hours ↗</Link></div></section>
      <CreateCheckout selection={selection} interval={interval} initialQuote={quote} initialAvailable={available}/></div>
      : <section className="journey-status" data-tone="warning"><h2>{unavailable?'We couldn’t check this visit':'Choose valid visit hours'}</h2><p role="status">{unavailable?'Availability and price are unavailable. Retry before paying.':'This space or these hours are unavailable. Edit your selection.'}</p>{unavailable&&<JourneyRetry label="Recheck this selection"/>}<Link className="text-link" href={selection?editVisitDestination(selection):'/#plan'}>Edit space, date or hours</Link></section>}
    <p><Link prefetch={false} href="/account">Your visits</Link></p></main><SiteFooter/></>;
}
