import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentHandler} from '../../supabase/functions/palmsteeze-payments/index';
test('controlled unsafe prepared-refund snapshot enters review without issuing a provider refund',async()=>{
 const attempt={id:randomUUID(),booking_id:randomUUID(),amount_kobo:200000,currency:'ngn',state:'refund_required',session_id:'cs_fixture',payment_intent_id:'pi_fixture',refund_id:null,cancel_requested:false,
  requested_expires_at:new Date().toISOString(),created_at:new Date().toISOString(),refund_started_at:new Date().toISOString(),refund_generation:0,refund_retry_requested:false,collected_kobo:200000,refunded_kobo:0};
 const calls:{url:string;method:string;body:Record<string,unknown>|null}[]=[];const lease=randomUUID();const token='fixture-token-for-unit-proof-only-00000000';
 const handler=paymentHandler({supabaseURL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',serviceKey:'nonsecret-fixture',stripeKey:'sk_test_nonsecret_fixture',workerToken:token,webhookSecret:'nonsecret-fixture',origin:'http://localhost:3000'},async(input,init)=>{
  const url=String(input);const body=url.includes('/rpc/')?JSON.parse(String(init?.body)):null;calls.push({url,method:init?.method||'GET',body});
  if(url.endsWith('/claim_payment_work')) return Response.json([{attempt,lease,dispatch_attempt:1}]);
  if(url.endsWith('/prepare_refund_operation')) return Response.json(attempt);
  if(url.includes('/payment_intents/')) return Response.json({id:attempt.payment_intent_id,livemode:false,status:'succeeded',amount_received:200000,currency:'ngn',metadata:{palmsteeze_payment_id:attempt.id}});
  if(url.includes('stripe.com/v1/refunds?')) return Response.json({has_more:false,data:[]});
  if(url.endsWith('/record_refund_snapshot')) return Response.json({code:'22023'},{status:400}); // controlled database rejection, not provider failure
  if(url.endsWith('/finish_payment_work')) return new Response(null,{status:204});
  throw new Error('Unexpected fixture request');
 });
 const result=await handler(new Request('http://localhost:3000/recover',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:attempt.booking_id})}));
 assert.equal(result.status,200);assert.deepEqual(await result.json(),{processed:1,completed:1,deferred:0});
 assert.equal(calls.some(c=>c.url.includes('stripe.com')&&c.method==='POST'),false);
 assert.equal(calls.some(c=>c.url.endsWith('/defer_payment_work')),false);
 assert.deepEqual(calls.find(c=>c.url.endsWith('/finish_payment_work'))?.body?.p_result,{result:'review_required'});
});

test('controlled permanent provider rejection retains prepared replacement for review without automatic retry',async()=>{
 const attempt={id:randomUUID(),booking_id:randomUUID(),amount_kobo:80000,currency:'ngn',state:'refund_required',session_id:'cs_fixture',payment_intent_id:'pi_fixture',refund_id:null,cancel_requested:false,
  requested_expires_at:new Date().toISOString(),created_at:new Date().toISOString(),refund_started_at:new Date().toISOString(),refund_generation:1,refund_retry_requested:false,collected_kobo:80000,refunded_kobo:0,refund_amount_kobo:80000,pending_refund_kobo:0};
 const lease=randomUUID();const token='fixture-token-for-unit-proof-only-00000000';let posts=0;let defers=0;let result:unknown;
 const handler=paymentHandler({supabaseURL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',serviceKey:'nonsecret-fixture',stripeKey:'sk_test_nonsecret_fixture',workerToken:token,webhookSecret:'nonsecret-fixture',origin:'http://localhost:3000'},async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/claim_payment_work')) return Response.json([{attempt,lease,dispatch_attempt:3}]);
  if(url.endsWith('/prepare_refund_operation')||url.endsWith('/record_refund_snapshot')) return Response.json(attempt);
  if(url.includes('/payment_intents/')) return Response.json({id:attempt.payment_intent_id,livemode:false,status:'succeeded',amount_received:80000,currency:'ngn',metadata:{palmsteeze_payment_id:attempt.id}});
  if(url.includes('stripe.com/v1/refunds?')) return Response.json({has_more:false,data:[]});
  if(url.endsWith('stripe.com/v1/refunds')) {posts++;assert.equal(new Headers(init?.headers).get('Idempotency-Key'),`palmsteeze-full-refund-${attempt.id}-retry-1`);return Response.json({error:{type:'invalid_request_error',message:'Controlled permanent refund rejection'}},{status:400});}
  if(url.endsWith('/stop_rejected_refund')) {result=JSON.parse(String(init?.body));return new Response(null,{status:204});}
  if(url.endsWith('/defer_payment_work')){defers++;return new Response(null,{status:204});}
  throw new Error('Unexpected fixture request');
 });
 const response=await handler(new Request('http://localhost:3000/recover',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId:attempt.booking_id})}));
 assert.equal(response.status,200);assert.equal(posts,1);assert.equal(defers,0);assert.deepEqual(result,{p_attempt:attempt.id,p_lease:lease});
});
