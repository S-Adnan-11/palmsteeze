import {currentAppOrigin} from '@/lib/request-origin';
import type {Metadata} from 'next';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {Wordmark} from '@/components/brand';
import {EntranceVerification} from '@/components/entrance-verification';
import {entranceDestination} from '@/lib/entrance';
import {clearanceCookie,validClearance} from '@/lib/security-sessions';
type Parameters={searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({searchParams}:Parameters):Promise<Metadata> {
  const overview=(await searchParams).overview==='1';
  return {title:overview?'PalmSteeze · Coworking booking demo':'Welcome · PalmSteeze',...(overview?{description:'Choose desks or meeting rooms in a fictional Agege, Lagos workspace. Explore bookings, sandbox payments and refund history with Google sign-in.',alternates:{canonical:'/'}}:{})};
}
export default async function Verify({searchParams}:Parameters) {
  const origin=await currentAppOrigin();
  const params=await searchParams;const destination=entranceDestination(params.next)||'/';
  if(validClearance((await cookies()).get(clearanceCookie)?.value,process.env,Date.now(),origin))redirect(destination);
  return <><header className="entrance-header"><Wordmark/></header><main className="entrance-page" id="main" tabIndex={-1}><div className="entrance-content">
    {params.overview==='1'&&<section className="entrance-overview" aria-labelledby="overview-title"><p className="eyebrow">Coworking booking demo</p><h1 id="overview-title">PalmSteeze</h1><p>Choose desks or meeting rooms in a fictional workspace in Agege, Lagos. Reserve time, try sandbox payments and manage your booking and refund history.</p><p>Google sign-in uses your name, email address and profile photo to identify your account and connect it to your bookings.</p></section>}
    <EntranceVerification destination={destination}/>
  </div></main><footer className="entrance-footer">Fictional workspace · Test payments only</footer></>;
}
