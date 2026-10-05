import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { adminSession } from '@/lib/admin';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function AdminLayout({children}:{children:React.ReactNode}) {
 await adminSession();return <><SiteHeader/><main id="main" className="admin-page"><p className="eyebrow">PalmSteeze administration · Development sandbox</p>
 <nav className="admin-nav" aria-label="Administration navigation">{[['/admin','Overview'],['/admin/bookings','Bookings'],['/admin/spaces','Spaces'],['/admin/availability','Availability'],['/admin/recovery','Refunds & recovery'],['/admin/audit','Audit']].map(([href,label])=><Link key={href} href={href} prefetch={false}>{label}</Link>)}</nav>{children}</main></>;
}
