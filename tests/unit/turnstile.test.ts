import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyReservationToken} from '../../src/lib/turnstile-verification';
import {turnstileConfiguration} from '../../src/lib/turnstile-config';
import {assertHostedEnvironment} from '../../src/lib/deployment';
const env={APP_ORIGIN:'http://localhost:3000',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'0x-fixture-site',TURNSTILE_SECRET_KEY:'0x-fixture-secret'};
const now=Date.now();
const success={success:true,hostname:'localhost',action:'reserve',challenge_ts:new Date(now).toISOString()};
test('server validation rejects missing, invalid, expired, reused, mismatched and unavailable challenges',async()=>{
  let calls=0;
  const verify=async(value:unknown,token:unknown='nonsecret-fixture')=>verifyReservationToken(token,env,async(_input,init)=>{
    calls++;assert.equal(init?.cache,'no-store');assert.ok(init?.signal);const form=init?.body as URLSearchParams;
    assert.equal(form.get('secret'),env.TURNSTILE_SECRET_KEY);assert.equal(form.get('remoteip'),null);
    return Response.json(value);
  },now);
  for(const token of [null,'',' ',42,'x'.repeat(2049)]) assert.equal((await verify(success,token)).ok,false);
  assert.equal(calls,0);
  assert.equal((await verify(success)).ok,true);
  for(const result of [{success:false,'error-codes':['invalid-input-response']},{success:false,'error-codes':['timeout-or-duplicate']},
    {...success,hostname:'evil.example'},{...success,action:'login'},{...success,challenge_ts:new Date(now-300001).toISOString()},
    {...success,challenge_ts:new Date(now+30001).toISOString()},{...success,challenge_ts:null},{...success,success:'true'}]) {
    assert.deepEqual((await verify(result)).ok,false);
  }
  for(const fetcher of [async()=>{throw new Error('Timeout');},async()=>new Response('unavailable',{status:503}),async()=>new Response('invalid-json')]) {
    const result=await verifyReservationToken('fixture',env,fetcher,now);assert.equal(result.ok,false);if(!result.ok) assert.equal(result.status,503);
  }
});
test('official test-key exceptions require explicit loopback configuration and cannot reach hosted production',async()=>{
  const testing={...env,NEXT_PUBLIC_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA',PALMSTEEZE_TURNSTILE_TEST_MODE:'true'};
  assert.doesNotThrow(()=>turnstileConfiguration(testing));
  for(const override of [{APP_ORIGIN:'https://preview.example'},{VERCEL:'1'},{VERCEL_ENV:'production'},{PALMSTEEZE_TURNSTILE_TEST_MODE:'false'},{TURNSTILE_SECRET_KEY:'0x-fixture'}]) {
    assert.throws(()=>turnstileConfiguration({...testing,...override}));
    assert.equal((await verifyReservationToken('fixture',{...testing,...override},async()=>Response.json(success))).ok,false);
  }
  assert.throws(()=>assertHostedEnvironment({...testing,APP_ORIGIN:'https://preview.example'}));
});
