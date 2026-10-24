import Link from 'next/link';
import { customerSession } from '@/lib/supabase/server';
import {SandboxDisclosure,Wordmark} from './brand';
export async function SiteHeader() {
  const session = await customerSession();
  return <><SandboxDisclosure/><header className="site-header"><Wordmark/><nav aria-label="Main navigation"><Link prefetch={false} href="/#spaces">Spaces</Link><Link href="/#how-it-works">How it works</Link><Link prefetch={false} href="/account">My bookings</Link><Link className="nav-signin" prefetch={false} href={session?'/account':'/login'}>{session?'Your account':'Sign in'}</Link><Link className="nav-cta" href="/#plan">Find a space <span aria-hidden="true">↗</span></Link></nav></header></>;
}
