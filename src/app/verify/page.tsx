import {currentAppOrigin} from '@/lib/request-origin';
import type {Metadata} from 'next';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {EntrancePage} from '@/components/entrance-page';
import {entranceDestination} from '@/lib/entrance';
import {clearanceCookie,validClearance} from '@/lib/security-sessions';

export const metadata:Metadata={title:'Verification · PalmSteeze',robots:{index:false,follow:false}};
export default async function Verify({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const origin=await currentAppOrigin();
  const params=await searchParams;const destination=entranceDestination(params.next)||'/';
  if(validClearance((await cookies()).get(clearanceCookie)?.value,process.env,Date.now(),origin))redirect(destination);
  return <EntrancePage destination={destination}/>;
}
