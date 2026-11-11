import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySubscriptionIngress } from './subscriptionIngress.mjs';

const signed = {
  provider: 'stripe_web', environment: 'sandbox',
  providerSubscriptionId: 'sub_a', providerEventId: 'evt_a',
  revision: 1, phase: 'trial', accessUntil: 9999,
};
const baseline = () => ({
  provider: 'stripe_web',
  rawBody: new TextEncoder().encode('opaque-provider-payload'),
  headers: { 'stripe-signature': 'opaque-signature' },
  environment: 'sandbox',
  expectedProviderEnvironment: 'sandbox',
  verifyProviderRequest: async () => signed,
  resolveOwner: async () => 'owner-a',
});

test('authenticated provider state and immutable owner map generate minimal fact', async () => {
  const input = baseline();
  input.verifyProviderRequest = async ({rawBody, environment}) => {
    assert.equal(rawBody, input.rawBody);
    assert.equal(environment, 'sandbox');
    return {...signed, userEmail:'secret@example.com', ownerId:'forged-client-owner'};
  };
  const result = await verifySubscriptionIngress(input);
  assert.equal(result.status, 'verified_for_transaction');
  assert.deepEqual(result.fact, {
    ownerId:'owner-a', provider:'stripe_web',
    providerSubscriptionId:'sub_a', providerEventId:'evt_a',
    revision:1, phase:'trial', accessUntil:9999,
  });
});

test('unsigned or tampered payload failure never invokes owner resolver', async () => {
  const input=baseline();
  let reads=0;
  input.verifyProviderRequest=async()=>{throw Error('invalid signature');};
  input.resolveOwner=async()=>{reads++;return 'owner-a';};
  assert.equal((await verifySubscriptionIngress(input)).status,'verification_failed');
  assert.equal(reads,0);
});

test('environment and provider mismatches fail closed', async () => {
  for (const patch of [
    {environment:'production'},
    {expectedProviderEnvironment:'production'},
    {provider:'google_play'},
    {provider:'other'},
    {rawBody:new Uint8Array()},
    {rawBody:new Uint8Array(1024 * 1024 + 1)},
    {headers:null},
  ]) {
    const result=await verifySubscriptionIngress({...baseline(),...patch});
    assert.notEqual(result.status,'verified_for_transaction');
  }
});

test('verifier cannot substitute provider or environment and must provide valid trusted state', async () => {
  for (const state of [
    null, {...signed, provider:'app_store'},
    {...signed, environment:'production'},
    {...signed, revision:-1}, {...signed, revision:1.5},
    {...signed, providerEventId:''},
    {...signed, accessUntil:null}, {...signed, phase:'untrusted'},
    {...signed, providerSubscriptionId:'sub\nother'},
  ]) {
    const input=baseline();
    input.verifyProviderRequest=async()=>state;
    assert.equal((await verifySubscriptionIngress(input)).status,'verification_failed');
  }
});

test('unresolved purchase ownership cannot authorize receipt', async () => {
  for (const owner of [null, '', ' owner-a', 'owner\nother']) {
    const input=baseline();
    input.resolveOwner=async()=>owner;
    const output=await verifySubscriptionIngress(input);
    assert.equal(output.status,'owner_unresolved');
    assert.equal('fact' in output,false);
  }
});

test('provider and ownership service exceptions fail closed', async () => {
  const input=baseline();
  input.resolveOwner=async()=>{throw Error('temporary DB outage');};
  assert.equal((await verifySubscriptionIngress(input)).status,'owner_unresolved');
  assert.equal((await verifySubscriptionIngress(null)).status,'invalid_request');
  assert.equal((await verifySubscriptionIngress({...baseline(),verifyProviderRequest:null})).status,'invalid_request');
});

test('signed refund or retry can be projected without granting paid access here', async () => {
  for (const phase of ['refunded', 'revoked', 'expired', 'billing_retry']) {
    const input=baseline();
    input.verifyProviderRequest=async()=>({...signed,phase,accessUntil:null});
    const result=await verifySubscriptionIngress(input);
    assert.equal(result.status,'verified_for_transaction');
    assert.equal(result.fact.phase,phase);
    assert.equal(result.fact.accessUntil,null);
  }
});
