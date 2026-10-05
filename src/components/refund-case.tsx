import {formatMoney} from '@/lib/domain';
import {venueTime,type AdminPayment,type AdminSnapshot} from '@/lib/admin';
import Link from 'next/link';
export function RefundCase({payment:p,refunds}:{payment:AdminPayment;refunds:AdminSnapshot['refunds']}){
 return <section className={p.refund_blocked?'refund-assistance':'refund-record'}>
  <h2>{p.refund_blocked ? 'Assistance required':'Refund record'}</h2>
  <p data-testid="reimbursement-outstanding">Outstanding reimbursement: <strong>{formatMoney(Number(p.collected_kobo)-Number(p.refunded_kobo))}</strong></p>
  {p.refund_blocked&&<><p data-testid="refund-failure-reason">Failure reason: Stripe permanently refused refund creation (HTTP 400, invalid_request_error). Automatic retries are stopped; an alternative reimbursement needs an administrator.</p><p>Stopped {p.refund_blocked_at&&venueTime(p.refund_blocked_at)}. This obligation is unresolved.</p><Link href="/admin/refund-assistance">Open the manual assistance procedure →</Link></>}
  <p className="reference">PaymentIntent: {p.payment_intent_id||'not recorded'}<br/>Checkout Session: {p.session_id||'not recorded'}<br/>Payment attempt: {p.id}</p>
  <ol className="refund-attempts">{refunds.filter(r=>r.attempt_id===p.id).map(r=><li key={r.id}>Attempt {r.generation}: <strong>{r.state}</strong> · {formatMoney(Number(r.amount_kobo))}<br/><span className="reference">Provider refund: {r.refund_id||'not created — no provider refund reference'}</span>{r.state==='failed'&&<p>Original provider failure reason: {r.provider_failure_reason?.replaceAll('_',' ')||'not captured historically; inspect the provider reference'}</p>}</li>)}</ol>
 </section>;
}
