import type { Metadata } from 'next';
import './globals.css';
import './presentation.css';
export const metadata: Metadata = {title:'PalmSteeze — Find your space. Set your pace.',description:'A fictional Lagos coworking venue. Explore open desks, quiet corners and whole meeting rooms.',icons:{icon:'/brand/palm-mark.svg'}};
export default function RootLayout({children}: {children:React.ReactNode}) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
