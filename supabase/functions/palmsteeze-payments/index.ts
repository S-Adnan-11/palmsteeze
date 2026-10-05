// One portable module serves the deployed Edge function and legitimate backend
// fault-injection tests. No test endpoint or authentication bypass is exposed.
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
export type PaymentConfig={supabaseURL:string;serviceKey:string;stripeKey:string;workerToken:string;webhookSecret:string;origin:string};
type Attempt={id:string;booking_id:string;amount_kobo:number;currency:string;state:string;session_id:string|null;
  payment_intent_id:string|null;refund_id:string|null;cancel_requested:boolean;requested_expires_at:string;created_at:string;refund_started_at:string|null;refund_generation:number;refund_retry_requested:boolean;
  refund_amount_kobo?:number;collected_kobo:number;refunded_kobo:number;pending_refund_kobo?:number};
type Work={attempt:Attempt;lease:string;dispatch_attempt:number};
type ProviderObject={id:string;livemode:boolean;amount_total?:number;amount?:number;amount_received?:number;currency:string;
  status:string;payment_status?:string;mode?:string;metadata?:Record<string,string>;payment_method_types?:string[];
  expires_at?:number;url?:string;payment_intent?:string|ProviderObject;data?:ProviderObject[];has_more?:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enc=new TextEncoder();
const equal=(a:Uint8Array,b:Uint8Array)=>{let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++) diff|=(a[i]||0)^(b[i]||0);return diff===0;};
async function opaqueEqual(a:string,b:string) {
  return equal(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(a))),new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(b))));
}
export async function verifySignature(body:string,header:string,secret:string,now=Date.now()) {
  const parts=header.split(',');const times=parts.filter(p=>p.startsWith('t='));
  if(times.length!==1 || !/^t=\d+$/.test(times[0])) return false;
  const t=Number(times[0].slice(2));if(Math.abs(now/1000-t)>300) return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(`${t}.${body}`)));
  return parts.filter(p=>/^v1=[a-f0-9]{64}$/.test(p)).some(p=>equal(signature,Uint8Array.from(p.slice(3).match(/../g)!,v=>parseInt(v,16))));
}
class WorkError extends Error {constructor(public code:'provider_unavailable'|'verification_failed'){super(code);}}
class CreationRejected extends WorkError {constructor(public parameter:string){super('provider_unavailable');}}
class RefundReviewRequired extends WorkError {constructor(){super('verification_failed');}}
class RefundCreationRejected extends WorkError {constructor(){super('verification_failed');}}
function check(condition:unknown):asserts condition {if(!condition) throw new WorkError('verification_failed');}
export function paymentHandler(config:PaymentConfig,fetcher:typeof fetch=fetch) {
  check(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.supabaseURL));
  check(/^(?:sk_test_|rk_test_|rkcs_test_)/.test(config.stripeKey));
  check(config.origin==='http://localhost:3000'); // M2 development only; deployment is excluded.
  const rpc=async(name:string,body:unknown)=>{
    const response=await fetcher(`${config.supabaseURL}/rest/v1/rpc/${name}`,{method:'POST',
      headers:{apikey:config.serviceKey,Authorization:`Bearer ${config.serviceKey}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok) {
      if(name==='record_refund_snapshot'&&response.status===400) {
        const problem=await response.json() as {code?:string};
        if(problem.code==='22023') throw new RefundReviewRequired();
      }
      throw new WorkError('provider_unavailable');
    }
    const text=await response.text();return text ? JSON.parse(text):null;
  };
  const stripe=async(path:string,body?:URLSearchParams,idempotency?:string):Promise<ProviderObject>=>{
    const response=await fetcher(`https://api.stripe.com/v1/${path}`,{
      method:body ? 'POST':'GET',headers:{Authorization:`Bearer ${config.stripeKey}`,'Stripe-Version':'2026-09-30.endive',
        ...(body ? {'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency ? {'Idempotency-Key':idempotency}:{})},
      body:body?.toString(),signal:AbortSignal.timeout(15000)});
    if(!response.ok) {
      // A definitive invalid refund request (including a card that already
      // rejected a prior refund) needs investigation. Preserve the prepared
      // generation and its key; do not endlessly retry or invent a result.
      if(path==='refunds'&&body&&response.status===400) {
        const rejected=await response.json() as {error?:{type?:string}};
        if(rejected.error?.type==='invalid_request_error') throw new RefundCreationRejected();
      }
      if(path==='checkout/sessions'&&body&&response.status===400) {
        const rejected=await response.json() as {error?:{type?:string;param?:string}};
        if(rejected.error?.type==='invalid_request_error'&&['allowed_payment_method_types','expires_at','line_items[0][price_data][unit_amount]'].includes(rejected.error.param||'')) throw new CreationRejected(rejected.error.param!);
      }
      throw new WorkError('provider_unavailable');
    }return await response.json();
  };
  const metadata=(body:URLSearchParams,a:Attempt,prefix='metadata')=>{
    body.set(`${prefix}[palmsteeze_payment_id]`,a.id);body.set(`${prefix}[palmsteeze_environment]`,'development');
  };
  async function process(work:Work) {
    let a=work.attempt;let result:Record<string,unknown>;
    const base={amount:Number(a.amount_kobo),currency:a.currency,environment:'sandbox'};
    if(a.state==='review_required') return rpc('finish_payment_work',{p_attempt:a.id,p_lease:work.lease,p_result:{result:'review_required'}});
    if(a.state==='refund_required'||(a.state==='refunded'&&a.refund_id)) {
      a=await rpc('prepare_refund_operation',{p_attempt:a.id,p_lease:work.lease,p_failed:null}) as Attempt;
      if(!a.refund_id && Date.now()-Date.parse(a.refund_started_at||a.created_at)>23*3600000) {
        return rpc('finish_payment_work',{p_attempt:a.id,p_lease:work.lease,p_result:{result:'review_required'}});
      }
      let refund:ProviderObject;
      check(a.payment_intent_id);
      const collected=await stripe(`payment_intents/${encodeURIComponent(a.payment_intent_id)}`);
      check(collected.livemode===false && collected.status==='succeeded' && collected.amount_received===Number(a.amount_kobo)
        && collected.currency===a.currency && collected.metadata?.palmsteeze_payment_id===a.id);
      const snapshot=async()=>{
        const list=await stripe(`refunds?payment_intent=${encodeURIComponent(a.payment_intent_id!)}&limit=100`);
        check(list.has_more===false && Array.isArray(list.data));
        for(const r of list.data) check(r.livemode!==true && r.currency===a.currency && r.payment_intent===a.payment_intent_id
          && Number.isSafeInteger(r.amount) && r.amount!>0 && ['pending','requires_action','succeeded','failed','canceled'].includes(r.status));
        a=await rpc('record_refund_snapshot',{p_attempt:a.id,p_lease:work.lease,p_collected:collected.amount_received,p_refunds:list.data}) as Attempt;
        return list.data;
      };
      let refunds=await snapshot();
      if(a.refund_id) {
        refund=refunds.find(r=>r.id===a.refund_id)!;
        check(refund && refund.amount===Number(a.refund_amount_kobo));
        if(a.refund_retry_requested && ['failed','canceled'].includes(refund.status)) {
          a=await rpc('prepare_refund_operation',{p_attempt:a.id,p_lease:work.lease,p_failed:{id:refund.id,status:refund.status,amount:refund.amount,currency:refund.currency,payment_intent:refund.payment_intent,environment:'sandbox'}}) as Attempt;
          await snapshot();
        }
      }
      if(!a.refund_id) {
        // Pending external refunds reserve funds too. Wait for an authoritative
        // terminal result instead of issuing another refund over those funds.
        if(a.pending_refund_kobo) throw new WorkError('provider_unavailable');
        check(a.payment_intent_id && Number.isSafeInteger(Number(a.refund_amount_kobo))
          && Number(a.refund_amount_kobo)>0 && Number(a.refund_amount_kobo)<=Number(a.collected_kobo)-Number(a.refunded_kobo));
        const body=new URLSearchParams({payment_intent:a.payment_intent_id,amount:String(a.refund_amount_kobo)});metadata(body,a);
        body.set('metadata[palmsteeze_refund_generation]',String(a.refund_generation));
        refund=await stripe('refunds',body,`palmsteeze-full-refund-${a.id}${a.refund_generation ? `-retry-${a.refund_generation}`:''}`);
        check(refund.livemode!==true && refund.amount===Number(a.refund_amount_kobo) && refund.currency===a.currency && refund.payment_intent===a.payment_intent_id);
        refunds=await snapshot();refund=refunds.find(r=>r.id===a.refund_id)!;
      }
      check(refund! && refund!.livemode!==true && refund!.amount===Number(a.refund_amount_kobo) && refund!.currency===a.currency && refund!.payment_intent===a.payment_intent_id);
      if(refund!.status==='succeeded' && Number(a.refunded_kobo)!==Number(a.collected_kobo)) {
        return rpc('finish_payment_work',{p_attempt:a.id,p_lease:work.lease,p_result:{result:'review_required'}});
      }
      result={...base,result:refund!.status==='succeeded' ? 'refunded':refund!.status==='failed'||refund!.status==='canceled' ? 'refund_failed':'refund_pending',refund_id:refund!.id,
        refund_amount:Number(a.refund_amount_kobo),collected_amount:Number(a.collected_kobo),refunded_amount:Number(a.refunded_kobo)};
    } else {
      let session:ProviderObject;
      if(a.session_id) session=await stripe(`checkout/sessions/${encodeURIComponent(a.session_id)}?expand[]=payment_intent`);
      else {
        // Stripe may prune idempotency keys after 24h. Never create another
        // session when an earlier response is still uncertain beyond that window.
        if(Date.now()-Date.parse(a.created_at)>23*3600000) {
          return rpc('finish_payment_work',{p_attempt:a.id,p_lease:work.lease,p_result:{result:'review_required'}});
        }
        const body=new URLSearchParams({mode:'payment',ui_mode:'hosted_page','allowed_payment_method_types[0]':'card',
          'adaptive_pricing[enabled]':'false','line_items[0][quantity]':'1','line_items[0][price_data][currency]':a.currency,
          'line_items[0][price_data][unit_amount]':String(a.amount_kobo),'line_items[0][price_data][product_data][name]':'PalmSteeze booking payment - sandbox',
          success_url:`${config.origin}/booking/${a.booking_id}?checkout=returned`,cancel_url:`${config.origin}/booking/${a.booking_id}?checkout=cancelled`,
          expires_at:String(Math.floor(Date.parse(a.requested_expires_at)/1000)),'expand[0]':'payment_intent'});
        metadata(body,a);metadata(body,a,'payment_intent_data[metadata]');
        try {session=await stripe('checkout/sessions',body,`palmsteeze-checkout-${a.id}`);}
        catch(error) {
          if(error instanceof CreationRejected && work.dispatch_attempt===1) {
            return rpc('finish_payment_work',{p_attempt:a.id,p_lease:work.lease,p_result:{...base,result:'creation_rejected',error_type:'invalid_request_error',error_param:error.parameter}});
          }
          throw error;
        }
      }
      check(session.livemode===false && session.mode==='payment' && session.amount_total===Number(a.amount_kobo) && session.currency===a.currency);
      check(session.metadata?.palmsteeze_payment_id===a.id && session.metadata?.palmsteeze_environment==='development');
      check(session.payment_method_types?.length===1 && session.payment_method_types[0]==='card');
      check(!a.session_id || session.id===a.session_id);
      if(a.cancel_requested && session.status==='open') {
        try {await stripe(`checkout/sessions/${encodeURIComponent(session.id)}/expire`,new URLSearchParams(),`palmsteeze-expire-${a.id}`);} catch { /* retrieve resolves a concurrent completed payment */ }
        session=await stripe(`checkout/sessions/${encodeURIComponent(session.id)}?expand[]=payment_intent`);
        check(session.livemode===false && session.amount_total===Number(a.amount_kobo) && session.currency===a.currency && session.metadata?.palmsteeze_payment_id===a.id);
      }
      const common={...base,session_id:session.id,expires_at:session.expires_at};
      if(session.status==='complete' && session.payment_status==='paid') {
        const intent=session.payment_intent;
        check(intent && typeof intent!=='string' && intent.livemode===false && intent.status==='succeeded'
          && intent.amount_received===Number(a.amount_kobo) && intent.currency===a.currency
          && intent.metadata?.palmsteeze_payment_id===a.id);
        check(!a.payment_intent_id || intent.id===a.payment_intent_id);
        result={...common,result:'paid',payment_intent_id:intent.id};
      } else if(session.status==='expired' && session.payment_status==='unpaid') result={...common,result:'expired'};
      else {
        check(session.status==='open' && session.payment_status==='unpaid');
        const url=new URL(session.url||'');check(url.protocol==='https:' && url.hostname==='checkout.stripe.com');
        result={...common,result:'open',checkout_url:session.url};
      }
    }
    if(result.result==='paid'&&a.payment_intent_id) {
      const list=await stripe(`refunds?payment_intent=${encodeURIComponent(a.payment_intent_id)}&limit=100`);
      check(list.has_more===false&&Array.isArray(list.data));
      for(const r of list.data) check(r.livemode!==true&&r.currency===a.currency&&r.payment_intent===a.payment_intent_id
        &&Number.isSafeInteger(r.amount)&&r.amount!>0&&['pending','requires_action','succeeded','failed','canceled'].includes(r.status));
      await rpc('record_refund_snapshot',{p_attempt:a.id,p_lease:work.lease,p_collected:a.amount_kobo,p_refunds:list.data});
    }
    await rpc('finish_payment_work',{p_attempt:a.id,p_lease:work.lease,p_result:result});
  }
  return async(request:Request):Promise<Response>=>{
    const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
    if(request.method!=='POST') return json({error:'POST required'},405);
    try {
      const path=new URL(request.url).pathname;
      if(path.endsWith('/webhook')) {
        if(Number(request.headers.get('content-length')||0)>256*1024) return json({error:'Too large'},413);
        const raw=await request.text();if(enc.encode(raw).length>256*1024) return json({error:'Too large'},413);
        if(!config.webhookSecret || !await verifySignature(raw,request.headers.get('stripe-signature')||'',config.webhookSecret)) return json({error:'Invalid signature'},400);
        const event=JSON.parse(raw) as {id:string;type:string;livemode:boolean;data:{object:ProviderObject}};
        const id=event.data?.object?.metadata?.palmsteeze_payment_id;
        if(event.livemode!==false || event.data.object.metadata?.palmsteeze_environment!=='development' || !id || !uuid.test(id)) return json({received:true,ignored:true});
        if(!['checkout.session.completed','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','refund.failed','charge.refunded'].includes(event.type)) return json({received:true,ignored:true});
        await rpc('receive_payment_event',{p_event:event.id,p_attempt:id,p_type:event.type,p_payload:event});
        return json({received:true}); // receipt + queued work committed before ACK.
      }
      if(!await opaqueEqual(request.headers.get('authorization')||'',`Bearer ${config.workerToken}`) || config.workerToken.length<32) return json({error:'Unauthorized'},401);
      const raw=await request.text();if(raw.length>2000) return json({error:'Too large'},413);
      const body=JSON.parse(raw||'{}') as Record<string,unknown>;
      if(!body || Array.isArray(body) || Object.keys(body).some(k=>k!=='bookingId') || (body.bookingId!==undefined && (typeof body.bookingId!=='string'||!uuid.test(body.bookingId)))) return json({error:'Invalid request'},400);
      const work=await rpc('claim_payment_work',{p_booking:body.bookingId||null,p_limit:2}) as Work[];
      let completed=0;let deferred=0;
      for(const item of work) {
        try {await process(item);completed++;}
        catch(error) {
          if(error instanceof RefundCreationRejected) {
            await rpc('stop_rejected_refund',{p_attempt:item.attempt.id,p_lease:item.lease});completed++;
          }else if(error instanceof RefundReviewRequired) {
            await rpc('finish_payment_work',{p_attempt:item.attempt.id,p_lease:item.lease,p_result:{result:'review_required'}});completed++;
          }else{await rpc('defer_payment_work',{p_attempt:item.attempt.id,p_lease:item.lease,p_error:error instanceof WorkError ? error.code:'provider_unavailable'});deferred++;}
        }
      }
      return json({processed:work.length,completed,deferred},deferred ? 503:200);
    } catch {return json({error:'Payment recovery temporarily unavailable'},503);}
  };
}
if(typeof Deno!=='undefined') Deno.serve(async request=>{
  try {
    const handler=paymentHandler({supabaseURL:Deno.env.get('SUPABASE_URL')||'',serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
      stripeKey:Deno.env.get('PALMSTEEZE_STRIPE_KEY')||'',workerToken:Deno.env.get('PALMSTEEZE_PAYMENT_WORKER_TOKEN')||'',
      webhookSecret:Deno.env.get('PALMSTEEZE_STRIPE_WEBHOOK_SECRET')||'',origin:Deno.env.get('PALMSTEEZE_APP_ORIGIN')||''});
    return await handler(request);
  } catch {return Response.json({error:'Payment service configuration unavailable'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
});
