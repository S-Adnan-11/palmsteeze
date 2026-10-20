import {canonicalOrigin} from '@/lib/search';
import {currentAppOrigin} from '@/lib/request-origin';
import type { Metadata } from 'next';
import {SkipLink} from '@/components/skip-link';
import {cookies} from 'next/headers';
import {PrivacyPreferences} from '@/components/privacy-preferences';
import {clearanceCookie,preferenceCookie,validClearance,readPreference} from '@/lib/security-sessions';
import './globals.css';
import './presentation.css';
import './redesign.css';
import 'react-day-picker/style.css';
import './refinement.css';
import './policies.css';
import './entrance.css';
// Booking reads can await bounded 40-second recovery; no background timer here.
export const maxDuration = 60;
const siteMetadata: Metadata = {robots:{index:false,follow:false},title:'PalmSteeze — Find your work rhythm.',description:'A fictional workspace in Agege, Lagos. Room to focus. Space to connect. Test payments only.',icons:{icon:[{url:'/brand/v2/favicon-192.png',type:'image/png',sizes:'192x192'},{url:'/brand/v2/favicon.ico',type:'image/x-icon'},{url:'/brand/v2/favicon.svg',type:'image/svg+xml',sizes:'any'}],apple:'/brand/v2/app-icon-180.png'},openGraph:{title:'PalmSteeze — Find your work rhythm.',description:'An imagined Agege, Lagos work club. Fictional venue. Test payments only.',images:[{url:'/brand/v2/open-graph.png',width:1200,height:630}]}};
export async function generateMetadata():Promise<Metadata> {
  return {...siteMetadata,metadataBase:new URL(canonicalOrigin),authors:[{name:'Adnan Muhammad Sadiq',url:'https://s-adnan.dev'}],twitter:{card:'summary_large_image',title:'PalmSteeze — Find your work rhythm.',description:'A fictional Agege, Lagos workspace. Test payments only.',images:['/brand/v2/open-graph.png']}};
}
export default async function RootLayout({children}: {children:React.ReactNode}) {
  const origin=await currentAppOrigin();
  const store=await cookies();
  return <html lang="en" data-scroll-behavior="smooth"><body><PrivacyPreferences initialCleared={validClearance(store.get(clearanceCookie)?.value,process.env,Date.now(),origin)} initialPreference={readPreference(store.get(preferenceCookie)?.value,process.env,Date.now(),origin)}><SkipLink/>{children}</PrivacyPreferences></body></html>;
}
