import type {Metadata} from 'next';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {Wordmark} from '@/components/brand';
import {EntranceVerification} from '@/components/entrance-verification';
import {entranceDestination} from '@/lib/entrance';
import {clearanceCookie,validClearance} from '@/lib/security-sessions';
export const metadata:Metadata={title:'Welcome · PalmSteeze'};
export default async function Verify({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;const destination=entranceDestination(params.next)||'/';
  if(validClearance((await cookies()).get(clearanceCookie)?.value,process.env))redirect(destination);
  return <><header className="entrance-header"><Wordmark/></header><main className="entrance-page" id="main" tabIndex={-1}><EntranceVerification destination={destination}/></main><footer className="entrance-footer">Fictional workspace · Test payments only</footer></>;
}
