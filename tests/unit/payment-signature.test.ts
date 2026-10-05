import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { verifySignature } from '../../supabase/functions/palmsteeze-payments/index';
test('raw-body webhook verification supports rotation and rejects tampering replay and ambiguous timestamps',async()=>{
 const stripe=new Stripe('sk_test_nonproduction_fixture');const secret='whsec_nonproduction_fixture';
 const payload=JSON.stringify({id:'evt_fixture',livemode:false});const timestamp=1000000;
 const header=stripe.webhooks.generateTestHeaderString({payload,secret,timestamp});
 assert.equal(await verifySignature(payload,header,secret,timestamp*1000),true);
 assert.equal(await verifySignature(payload,header+',v1='+'0'.repeat(64),secret,timestamp*1000),true);
 assert.equal(await verifySignature(payload+' ',header,secret,timestamp*1000),false);
 assert.equal(await verifySignature(payload,header,secret,(timestamp+301)*1000),false);
 assert.equal(await verifySignature(payload,header,secret,(timestamp-301)*1000),false);
 assert.equal(await verifySignature(payload,header+`,t=${timestamp}`,secret,timestamp*1000),false);
 assert.equal(await verifySignature(payload,'t=1,v1=invalid',secret,timestamp*1000),false);
});
