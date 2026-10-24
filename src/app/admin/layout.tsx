import {adminSession} from '@/lib/admin';
import {AdminShell} from '@/components/admin-shell';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function AdminLayout({children}:{children:React.ReactNode}) {
  await adminSession();
  return <AdminShell>{children}</AdminShell>;
}
