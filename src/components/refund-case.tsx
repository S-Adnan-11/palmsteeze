import {venueTime,type AdminPayment,type AdminSnapshot} from '@/lib/admin';
import Link from 'next/link';
import {RefundSummary} from '@/components/refund-summary';
export function RefundCase({payment:p,refunds}:{payment:AdminPayment;refunds:AdminSnapshot['refunds']}) {
  return <><RefundSummary data={{outstandingKobo:Number(p.collected_kobo)-Number(p.refunded_kobo),blocked:p.refund_blocked,reason:'Failure reason: Stripe permanently refused refund creation (HTTP 400, invalid_request_error). An alternative reimbursement needs an administrator.',stoppedAt:p.refund_blocked_at?venueTime(p.refund_blocked_at):undefined,paymentReference:p.payment_intent_id||'not recorded',sessionReference:p.session_id||'not recorded',attemptReference:p.id,attempts:refunds.filter(r=>r.attempt_id===p.id).map(r=>({id:r.id,generation:r.generation,state:r.state,amountKobo:Number(r.amount_kobo),providerReference:r.refund_id,failureReason:r.provider_failure_reason}))}}/>{p.refund_blocked&&<Link className="text-link" href="/admin/refund-assistance">Open the manual assistance procedure →</Link>}</>;
}
