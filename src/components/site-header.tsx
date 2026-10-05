import Link from 'next/link';
import { customerSession } from '@/lib/supabase/server';
import {Wordmark} from './brand';
export async function SiteHeader() {
  const session = await customerSession();
  return <header className="site-header"><Wordmark/>
    <nav aria-label="Main navigation"><Link prefetch={false} href="/#spaces">Our spaces</Link><Link prefetch={false} href="/#venue">The workspace</Link><Link href="/preview/admin">Admin preview</Link>
      <Link className="nav-cta" prefetch={false} href={session ? '/account' : '/login'}>{session ? 'Your visits' : 'Sign in'} <span aria-hidden="true">↗</span></Link>
    </nav></header>;
}
