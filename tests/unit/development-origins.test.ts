import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {allowedAppOrigins,developmentOrigins,requestAppOrigin,sameAppOrigin,validatedAppOrigin} from '../../src/lib/deployment';
import {createClearance,validClearance,createPreference,readPreference,securityCookieOptions} from '../../src/lib/security-sessions';
import {verifyTurnstileToken} from '../../src/lib/turnstile-verification';
import {reservationCapability} from '../../src/lib/reservation-capability';
import {paymentHandler} from '../../supabase/functions/palmsteeze-payments/index';
import {hostedOrigin,paymentReturnOrigins,sharedServiceOrigins} from '../../supabase/functions/_shared/application-origins';

const [local,tunnel]=developmentOrigins;
const env={APP_ORIGIN:local,PALMSTEEZE_SECURITY_SECRET:'ab'.repeat(32),NEXT_PUBLIC_TURNSTILE_SITE_KEY:'0x-fixture',TURNSTILE_SECRET_KEY:'fixture'};
const now=Date.now();
function request(origin:string,extra:Record<string,string>={}) {
  return new Request('http://localhost:3000/api/verification',{headers:{Host:new URL(origin).host,Origin:origin,'X-Forwarded-Proto':new URL(origin).protocol.slice(0,-1),...extra}});
}

test('exact development origins authorize only matching Host/Origin/proxy combinations',()=>{
  assert.deepEqual(allowedAppOrigins(env),developmentOrigins);
  for(const origin of developmentOrigins) {
    assert.equal(requestAppOrigin(request(origin),env),origin);
    assert.equal(sameAppOrigin(request(origin),env),true);
    const rejected:Record<string,string>[]=[{Origin:'https://evil.example'},{Origin:origin===local?tunnel:local},
      {Host:'evil.example'},{Host:new URL(origin).host+':443'},{Origin:'null'},
      {'X-Forwarded-Host':'evil.example'},{'X-Forwarded-Host':new URL(origin).host+', evil.example'},
      {'X-Forwarded-Proto':origin===local?'https':'http'},{'X-Forwarded-Proto':'https,http'}];
    for(const extra of rejected) {
      assert.equal(sameAppOrigin(request(origin,extra),env),false,JSON.stringify(extra));
    }
  }
  for(const value of ['https://evil.example',tunnel+'/',tunnel+':443',tunnel.replace('https:','http:'),'https://other.euw.devtunnels.ms']) {
    assert.throws(()=>validatedAppOrigin(value,env));
  }
  assert.throws(()=>requestAppOrigin(new Request(tunnel,{headers:{'X-Forwarded-Host':new URL(tunnel).host}}),env));
  const production={...env,APP_ORIGIN:'https://palmsteeze.example',VERCEL:'1'};
  assert.deepEqual(allowedAppOrigins(production),[production.APP_ORIGIN]);
  assert.equal(sameAppOrigin(request(tunnel),production),false);
  assert.equal(sameAppOrigin(request(local),production),false);
});

test('shared backend destinations preserve development returns without granting hosted HTTP privileges',()=>{
  assert.deepEqual(paymentReturnOrigins(local),sharedServiceOrigins);
  assert.deepEqual(paymentReturnOrigins(hostedOrigin),sharedServiceOrigins);
  const hosted={...env,APP_ORIGIN:hostedOrigin,VERCEL:'1'};
  assert.deepEqual(allowedAppOrigins(hosted),[hostedOrigin]);
  for(const origin of developmentOrigins) assert.equal(sameAppOrigin(request(origin),hosted),false);
  assert.equal(sameAppOrigin(request(hostedOrigin),hosted),true);
  assert.deepEqual(paymentReturnOrigins('https://unconfigured.example'),['https://unconfigured.example']);
});

test('clearance and preferences remain origin-bound; HTTPS cookies are secure and host-only',()=>{
  for(const origin of developmentOrigins) {
    const clearance=createClearance(env,now,origin),preference=createPreference(true,env,now,origin);
    assert.equal(validClearance(clearance,env,now,origin),true);
    assert.deepEqual(readPreference(preference,env,now,origin),{optional:true});
    assert.equal(validClearance(clearance,env,now,origin===local?tunnel:local),false);
    assert.equal(readPreference(preference,env,now,origin===local?tunnel:local),null);
    assert.equal(validClearance(clearance,env,now+1800000,origin),false);
    const options=securityCookieOptions(env,1800,origin);
    assert.equal(options.secure,origin===tunnel);
    assert.equal(Object.hasOwn(options,'domain'),false);
  }
});

test('genuine Siteverify metadata must match this request hostname AND each independent action',async()=>{
  for(const origin of developmentOrigins) for(const action of ['entrance','reserve'] as const) {
    const result={success:true,hostname:new URL(origin).hostname,action,challenge_ts:new Date(now).toISOString()};
    const verify=(value:unknown)=>verifyTurnstileToken('fixture',env,action,async()=>Response.json(value),now,origin);
    assert.equal((await verify(result)).ok,true);
    assert.equal((await verify({...result,hostname:new URL(origin===local?tunnel:local).hostname})).ok,false);
    assert.equal((await verify({...result,action:action==='entrance'?'reserve':'entrance'})).ok,false);
    assert.equal((await verify({...result,success:false,'error-codes':['timeout-or-duplicate']})).ok,false);
  }
  const testing={...env,PALMSTEEZE_TURNSTILE_TEST_MODE:'true',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'};
  assert.equal((await verifyTurnstileToken('fixture',testing,'entrance',async()=>Response.json({success:true}),now,tunnel)).ok,false);
});

test('reservation capabilities contain the validated initiating origin without accepting unknown origins',()=>{
  const intent={userId:randomUUID(),operation:'hold' as const,resourceId:randomUUID(),startsAt:new Date(now).toISOString(),endsAt:new Date(now+3600000).toISOString(),requestId:randomUUID(),amountKobo:null,expectedQuote:null};
  for(const origin of developmentOrigins) {
    const cap=reservationCapability(intent,env,now,origin);
    assert.equal(JSON.parse(Buffer.from(cap.split('.')[0],'base64url').toString()).origin,origin);
  }
  assert.throws(()=>reservationCapability(intent,env,now,'https://evil.example'));
});

test('scheduled workers use persisted origins, reject unsafe origins, and retain historical fallback',async()=>{
  for(const [canonical,initiatingOrigin] of [[local,local],[local,tunnel],[local,hostedOrigin],[hostedOrigin,tunnel],[hostedOrigin,local],[hostedOrigin,hostedOrigin],[local,null],[local,'https://evil.example'],['https://palmsteeze.example',tunnel],['https://palmsteeze.example',null]]) {
    const bookingId=randomUUID(),id=randomUUID();let checkout:URLSearchParams|undefined;let deferred=false;
    const handler=paymentHandler({supabaseURL:`https://${'a'.repeat(20)}.supabase.co`,serviceKey:'fixture',stripeKey:'sk_test_fixture',workerToken:'x'.repeat(40),webhookSecret:'fixture',origin:canonical!},async(input,init)=>{
      const url=String(input);
      if(url.endsWith('/claim_payment_work')) return Response.json([{lease:randomUUID(),dispatch_attempt:1,attempt:{id,booking_id:bookingId,amount_kobo:80000,currency:'ngn',state:'creating',session_id:null,created_at:new Date(now).toISOString(),requested_expires_at:new Date(now+35*60000).toISOString(),return_origin:initiatingOrigin}}]);
      if(url.endsWith('/checkout/sessions')) {
        checkout=new URLSearchParams(String(init?.body));
        return Response.json({id:'cs_fixture',livemode:false,mode:'payment',amount_total:80000,currency:'ngn',status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/fixture',metadata:{palmsteeze_payment_id:id,palmsteeze_environment:'development'},payment_method_types:['card']});
      }
      if(url.endsWith('/finish_payment_work')) return new Response(null,{status:204});
      if(url.endsWith('/defer_payment_work')) {deferred=true;return new Response(null,{status:204});}
      throw new Error('Unexpected controlled request');
    });
    // No bookingId: the actual scheduled-worker entry path, with spoofed headers.
    const response=await handler(new Request('https://worker.example/recover',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(40),Origin:'https://evil.example','X-Forwarded-Host':'evil.example'},body:'{}'}));
    if(initiatingOrigin==='https://evil.example'||(canonical==='https://palmsteeze.example'&&initiatingOrigin===tunnel)) {
      assert.equal(response.status,503);assert.equal(checkout,undefined);assert.equal(deferred,true);
    } else {
      assert.equal(response.status,200);
      assert.equal(checkout?.get('success_url'),`${initiatingOrigin??canonical}/booking/${bookingId}?checkout=returned`);
      assert.equal(checkout?.get('cancel_url'),`${initiatingOrigin??canonical}/booking/${bookingId}?checkout=cancelled`);
    }
  }
});
