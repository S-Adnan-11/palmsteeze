import type { Metadata } from 'next';
import { appOrigin } from '@/lib/auth/config';
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
export const metadata: Metadata = {metadataBase:new URL(appOrigin()),title:'PalmSteeze — Find your work rhythm.',description:'A fictional Lagos workspace. Room to focus. Space to connect. Test payments only.',icons:{icon:[{url:'/brand/v2/favicon.svg',type:'image/svg+xml'},{url:'/brand/v2/favicon.ico'}],apple:'/brand/v2/app-icon-180.png'},openGraph:{title:'PalmSteeze — Find your work rhythm.',description:'An imagined Lagos work club. Fictional venue. Test payments only.',images:[{url:'/brand/v2/open-graph.png',width:1200,height:630}]}};
export default async function RootLayout({children}: {children:React.ReactNode}) {
  const store=await cookies();
  return <html lang="en"><body><PrivacyPreferences initialCleared={validClearance(store.get(clearanceCookie)?.value,process.env)} initialPreference={readPreference(store.get(preferenceCookie)?.value,process.env)}><a className="skip-link" href="#main">Skip to content</a>{children}</PrivacyPreferences></body></html>;
}
