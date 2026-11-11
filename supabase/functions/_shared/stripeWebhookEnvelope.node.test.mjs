import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateStripeWebhookEnvelope } from './stripeWebhookEnvelope.mjs';

const secret = 'whsec_test_only_not_a_real_secret_0123456789';
const nowSeconds = 1794400000;
const encode = new TextEncoder();
async function fixture(payload, {timestamp = nowSeconds, body} = {}) {
  const rawBody = body ?? encode.encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', encode.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed = encode.encode(String(timestamp) + '.');
  const bytes = new Uint8Array(signed.length + rawBody.length);
  bytes.set(signed);
  bytes.set(rawBody,signed.length);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes));
  const signature = [...mac].map(x=>x.toString(16).padStart(2,'0')).join('');
  return { rawBody, webhookSecret:secret, signatureHeader:`t=${timestamp},v1=${signature}`,
    nowSeconds, expectedLiveMode:false };
}
const payload = {id:'evt_test_1', type:'customer.subscription.updated',
  livemode:false, data:{object:{id:'sub_test',status:'active',metadata:{ownerId:'FORGED'}}}};

test('valid sandbox Stripe signature authenticates envelope only, never entitlements', async()=>{
  const result=await authenticateStripeWebhookEnvelope(await fixture(payload));
  assert.deepEqual(result,{status:'authenticated_envelope',eventId:'evt_test_1',
    eventType:'customer.subscription.updated',liveMode:false});
  assert.equal('ownerId' in result,false);
  assert.equal('phase' in result,false);
});

test('tampered raw bytes, incorrect secret and missing signatures reject',async()=>{
  const good=await fixture(payload);
  assert.equal((await authenticateStripeWebhookEnvelope({...good,
    rawBody:encode.encode(JSON.stringify({...payload,type:'invoice.paid'}))})).status,
    'signature_rejected');
  assert.equal((await authenticateStripeWebhookEnvelope({...good,webhookSecret:'whsec_a_different_secret'})).status,
    'signature_rejected');
  assert.equal((await authenticateStripeWebhookEnvelope({...good,signatureHeader:'t=1794400000,v1=bad'})).status,
    'signature_rejected');
});

test('timestamp tolerance blocks replay, including future timestamps',async()=>{
  for(const t of [nowSeconds-301,nowSeconds+301]){
    assert.equal((await authenticateStripeWebhookEnvelope(await fixture(payload,{timestamp:t}))).status,
      'signature_rejected');
  }
  assert.equal((await authenticateStripeWebhookEnvelope(await fixture(payload,{timestamp:nowSeconds-300}))).status,
    'authenticated_envelope');
});

test('signed live-mode payload is rejected by sandbox verifier and vice versa',async()=>{
  const signedLive=await fixture({...payload,livemode:true});
  assert.equal((await authenticateStripeWebhookEnvelope(signedLive)).status,'payload_rejected');
  const signedSandbox=await fixture(payload);
  assert.equal((await authenticateStripeWebhookEnvelope({...signedSandbox,expectedLiveMode:true})).status,
    'payload_rejected');
});

test('signed payload must be valid event envelope',async()=>{
  for(const bad of [
    {...payload,id:'fake'},
    {...payload,data:null},
    {...payload,type:12},
    {...payload,livemode:'false'},
  ]){
    assert.equal((await authenticateStripeWebhookEnvelope(await fixture(bad))).status,
      'payload_rejected');
  }
  const notJson=await fixture(null,{body:encode.encode('not-json')});
  assert.equal((await authenticateStripeWebhookEnvelope(notJson)).status,'payload_rejected');
});

test('rejects huge payload and malformed timestamp before expensive signature verification',async()=>{
  const good=await fixture(payload);
  for(const patch of [
    {rawBody:new Uint8Array(1024*1024+1)},
    {signatureHeader:'v1=' + 'a'.repeat(64)},
    {signatureHeader:'t=nope,v1='+'a'.repeat(64)},
    {nowSeconds:NaN},
    {webhookSecret:''},
  ]){
    const outcome=(await authenticateStripeWebhookEnvelope({...good,...patch})).status;
    assert.notEqual(outcome,'authenticated_envelope');
  }
});
