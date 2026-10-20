import type {Metadata} from 'next';
import {cookies} from 'next/headers';
import {currentAppOrigin} from '@/lib/request-origin';
import {clearanceCookie,validClearance} from '@/lib/security-sessions';
import {EntrancePage} from '@/components/entrance-page';
import {canonicalOrigin,demoDescription,searchPage} from '@/lib/search';
import {entranceDestination} from '@/lib/entrance';
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<Metadata> {
  const metadata=searchPage('/','PalmSteeze · Coworking booking demo',demoDescription);
  if(Object.keys(await searchParams).length)metadata.robots={index:false,follow:false};
  return metadata;
}
import Image from 'next/image';
import {getCatalog} from '@/lib/catalog';
import {formatMoney} from '@/lib/domain';
import {WorkspaceExplorer} from '@/components/workspace-explorer';
import {SiteHeader} from '@/components/site-header';
import {SiteFooter} from '@/components/brand';
import {ArrowLink} from '@/components/arrow-link';
import {WorkspaceExperience} from '@/components/workspace-experience';
export const dynamic='force-dynamic';
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const websiteSchema=<script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({
    '@context':'https://schema.org',
    '@type':'WebSite',
    name:'PalmSteeze',
    alternateName:'palmsteeze.devs.surf',
    url:canonicalOrigin+'/',
  }).replace(/</g,'\\u003c')}}/>;
  const origin=await currentAppOrigin();
  if(!validClearance((await cookies()).get(clearanceCookie)?.value,process.env,Date.now(),origin)) {
    const query=new URLSearchParams();
    for(const [key,value] of Object.entries(await searchParams))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])query.append(key,item);
    return <>{websiteSchema}<EntrancePage destination={entranceDestination('/'+(query.size?'?'+query.toString():''))||'/'}/></>;
  }
  const catalog=await getCatalog();
  const weekdays=catalog.settings.open_weekdays.join(',')==='1,2,3,4,5,6'?'Mon–Sat':catalog.settings.open_weekdays.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
  const deskRates=catalog.resources.filter(r=>r.kind!=='room').map(r=>r.hourly_kobo);
  return <>{websiteSchema}<SiteHeader/><main id="main" tabIndex={-1}>
    <section className="rhythm-hero" aria-labelledby="hero-title"><div className="rhythm-copy"><p className="eyebrow"><span className="eyebrow-line"/> Your next good workday</p><h1 id="hero-title">Find your<br/><em>work rhythm.</em></h1><p className="hero-description">A desk for deep focus. A room for fresh ideas.<br/>Make space for the way you work.</p><ArrowLink href="#plan">Find your space</ArrowLink><div className="hero-facts"><div><span>Desks from</span><strong>{deskRates.length?formatMoney(Math.min(...deskRates)):'—'} <small>/ hour</small></strong></div><div><span>Rooms for</span><strong>4–10 <small>people</small></strong></div></div></div><figure className="rhythm-image"><Image src="/spaces/hero.webp" width={1536} height={1024} sizes="(max-width: 760px) 100vw, 60vw" preload alt="Generated impression of an imagined sunlit work studio with timber desks, green chairs and an arched window"/><figcaption><span>A little room. A lot of possibility.</span><span aria-hidden="true">↗</span></figcaption><span className="image-index" aria-hidden="true">01 / THE WORK CLUB</span></figure></section>
    <section id="venue" className="venue-ribbon" aria-label="Workspace details"><p>↗ {catalog.settings.district}</p><p>24 individual desks · 3 whole rooms</p><p>{weekdays} · {String(catalog.settings.opens_hour).padStart(2,'0')}:00–{String(catalog.settings.closes_hour).padStart(2,'0')}:00 WAT</p></section>
    <WorkspaceExperience/>
    <WorkspaceExplorer catalog={catalog}/>
    <section id="how-it-works" className="how-section" aria-labelledby="how-title"><div><p className="eyebrow">Less planning. More doing.</p><h2 id="how-title">A good day starts<br/><em>in three simple steps.</em></h2><p>Come for an hour. Settle into your flow.</p></div><ol><li><span>01</span><div><h3>Choose your kind of space</h3><p>An open desk, a quiet corner or a whole room for your team.</p></div></li><li><span>02</span><div><h3>Make time for it</h3><p>Pick your date and hours. Check availability, then review your price.</p></div></li><li><span>03</span><div><h3>Book at your pace</h3><p>Sign in and pay the minimum deposit, a higher amount or the full total. This demo uses test payments only.</p></div></li></ol></section>
    <section className="rhythm-closing"><div><p className="eyebrow">Room to focus. Space to connect.</p><h2>Your next chapter<br/>could start <em>right here.</em></h2></div><ArrowLink href="#plan">Plan your visit</ArrowLink></section>
  </main><SiteFooter/></>;
}
