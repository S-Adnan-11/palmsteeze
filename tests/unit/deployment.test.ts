import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { configuredAppOrigin,sameConfiguredOrigin,assertHostedEnvironment,assertHostedNode } from '../../src/lib/deployment';
import { paymentHandler } from '../../supabase/functions/palmsteeze-payments/index';

const origin = 'https://palmsteeze.example';
const env = {APP_ORIGIN:origin,VERCEL:'1',SUPABASE_PROJECT_REF:'a'.repeat(20),
  NEXT_PUBLIC_SUPABASE_URL:`https://${'a'.repeat(20)}.supabase.co`,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
  PALMSTEEZE_DB_DEDICATED:'true',PALMSTEEZE_DB_FREE_CONFIRMED:'true',PALMSTEEZE_PAYMENT_WORKER_TOKEN:'fixture'.repeat(8)};

test('hosting fails closed without canonical HTTPS origin and keeps local development usable',() => {
  assert.equal(configuredAppOrigin({}),'http://localhost:3000');
  assert.equal(configuredAppOrigin({...env,VERCEL_URL:'untrusted-deployment.example'}),origin);
  for (const value of ['', 'http://localhost:3000', 'http://palmsteeze.example', `${origin}/`, `${origin}/callback`,
    `${origin}?next=evil`,`${origin}#fragment`,'https://user:password@palmsteeze.example','https://localhost']) {
    assert.throws(() => configuredAppOrigin({APP_ORIGIN:value,VERCEL:'1'}));
  }
});

test('canonical Origin and Host authorize HTTPS behind internal HTTP normalization without trusting forwarded claims',() => {
  const request = (headers:Record<string,string>) => new Request('http://localhost:3000/api/checkout',{headers});
  assert.equal(sameConfiguredOrigin(request({Origin:origin,Host:'palmsteeze.example'}),origin),true);
  const rejected:Record<string,string>[] = [{Origin:'https://evil.example',Host:'evil.example'}, {Origin:origin,Host:'evil.example'},
    {Origin:origin,'X-Forwarded-Host':'palmsteeze.example'}, {Origin:'http://palmsteeze.example',Host:'palmsteeze.example'}];
  for (const headers of rejected) {
    assert.equal(sameConfiguredOrigin(request(headers),origin),false);
  }
});

test('hosted build requires dedicated public configuration and keeps privileged tooling keys out',() => {
  assert.equal(assertHostedEnvironment(env),origin);
  for (const name of Object.keys(env).filter(name => name !== 'VERCEL')) assert.throws(() => assertHostedEnvironment({...env,[name]:''}));
  assert.throws(() => assertHostedEnvironment({...env,NEXT_PUBLIC_SUPABASE_URL:'https://other.example'}));
  assert.throws(() => assertHostedEnvironment({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'}));
  const serviceKey = `header.${btoa(JSON.stringify({role:'service_role'}))}.signature`;
  assert.throws(() => assertHostedEnvironment({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:serviceKey}));
  for (const name of ['DATABASE_PASSWORD','SUPABASE_SECRET_KEY','SUPABASE_ACCESS_TOKEN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']) {
    assert.throws(() => assertHostedEnvironment({...env,[name]:'private-fixture'}));
  }
  for (const version of ['24.21.0','24.22.1']) assert.doesNotThrow(() => assertHostedNode(version));
  for (const version of ['22.21.0','24.20.9','25.0.0','invalid']) assert.throws(() => assertHostedNode(version));
});

test('hosted Checkout uses configured origin despite spoofed caller headers; sandbox authority unchanged',async () => {
  const id = randomUUID(),bookingId = randomUUID(),lease = randomUUID();
  const attempt = {id,booking_id:bookingId,amount_kobo:80000,currency:'ngn',state:'creating',session_id:null,
    payment_intent_id:null,refund_id:null,cancel_requested:false,created_at:new Date().toISOString(),
    requested_expires_at:new Date(Date.now()+35*60000).toISOString(),collected_kobo:0,refunded_kobo:0};
  let checkout:URLSearchParams | undefined;let result:Record<string,unknown> | undefined;
  const config = {supabaseURL:env.NEXT_PUBLIC_SUPABASE_URL,serviceKey:'nonsecret-fixture',stripeKey:'sk_test_nonsecret_fixture',
    workerToken:env.PALMSTEEZE_PAYMENT_WORKER_TOKEN,webhookSecret:'whsec_nonsecret_fixture',origin};
  const fetcher:typeof fetch = async (input,init) => {
    const url = String(input);
    if (url.endsWith('/claim_payment_work')) return Response.json([{attempt,lease,dispatch_attempt:1}]);
    if (url.endsWith('/checkout/sessions')) {
      checkout = new URLSearchParams(String(init?.body));
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'),`palmsteeze-checkout-${id}`);
      return Response.json({id:'cs_fixture',livemode:false,mode:'payment',amount_total:80000,currency:'ngn',
        status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/fixture',
        metadata:{palmsteeze_payment_id:id,palmsteeze_environment:'development'},payment_method_types:['card'],expires_at:1234567});
    }
    if (url.endsWith('/finish_payment_work')) { result = JSON.parse(String(init?.body)).p_result;return new Response(null,{status:204}); }
    throw new Error('Unexpected controlled request');
  };
  const handler = paymentHandler(config,fetcher);
  const unauthorized = await handler(new Request('https://worker.example/recover',{method:'POST',body:'{}'}));
  assert.equal(unauthorized.status,401);
  const response = await handler(new Request('https://evil.example/recover',{method:'POST',
    headers:{Authorization:`Bearer ${config.workerToken}`,Origin:'https://evil.example','X-Forwarded-Host':'evil.example'},body:JSON.stringify({bookingId})}));
  assert.equal(response.status,200);
  assert.equal(checkout?.get('success_url'),`${origin}/booking/${bookingId}?checkout=returned`);
  assert.equal(checkout?.get('cancel_url'),`${origin}/booking/${bookingId}?checkout=cancelled`);
  assert.equal(checkout?.get('line_items[0][price_data][unit_amount]'),'80000');
  assert.equal(checkout?.get('metadata[palmsteeze_environment]'),'development');
  assert.equal(result?.result,'open');
  for (const badOrigin of ['http://evil.example',`${origin}/`,`${origin}/bookings`,`${origin}?evil=1`,'https://user@palmsteeze.example','https://localhost']) {
    assert.throws(() => paymentHandler({...config,origin:badOrigin},fetcher));
  }
  assert.throws(() => paymentHandler({...config,stripeKey:'sk_live_nonsecret_fixture'},fetcher));
});
