import {Wordmark} from '@/components/brand';
import {EntranceVerification} from '@/components/entrance-verification';

export function EntrancePage({destination}:{destination:string}) {
  return <><header className="entrance-header"><Wordmark/></header><main className="entrance-page" id="main" tabIndex={-1}><div className="entrance-content">
    <section className="entrance-overview" aria-labelledby="overview-title"><h1 id="overview-title">Welcome to <em>PalmSteeze.</em></h1><p>Explore desks, meeting rooms and test bookings in a fictional Agege, Lagos coworking space.</p></section>
    <EntranceVerification destination={destination}/>
    <details className="entrance-about"><summary>About PalmSteeze</summary><p>A personal portfolio demo by Adnan Muhammad Sadiq, inspired by looking for coworking spaces in Lagos. After verification, explore the planner, Google sign-in, sandbox payments and booking and refund history. No real venue or charges.</p></details>
  </div></main><footer className="entrance-footer">Fictional workspace · Test payments only</footer></>;
}
