import type { Metadata } from 'next';
import { appOrigin } from '@/lib/auth/config';
import './globals.css';
import './presentation.css';
import './redesign.css';
export const metadata: Metadata = {metadataBase:new URL(appOrigin()),title:'PalmSteeze — Find your work rhythm.',description:'A fictional Lagos workspace. Room to focus. Space to connect. Test payments only.',icons:{icon:[{url:'/brand/v2/favicon.svg',type:'image/svg+xml'},{url:'/brand/v2/favicon.ico'}],apple:'/brand/v2/app-icon-180.png'},openGraph:{title:'PalmSteeze — Find your work rhythm.',description:'An imagined Lagos work club. Fictional venue. Test payments only.',images:[{url:'/brand/v2/open-graph.png',width:1200,height:630}]}};
export default function RootLayout({children}: {children:React.ReactNode}) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
