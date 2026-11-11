import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeVerifiedPurchaseBinding as authorize } from './subscriptionPurchaseBinding.mjs';

const checkoutAttempt=Object.freeze({
  ownerId:'owner_a',attemptId:'10000000-0000-0000-0000-000000000001',provider:'stripe_web',
  environment:'sandbox',providerSubscriptionId:'sub_1',
  providerCheckoutId:'cs_1',state:'server_confirmed',
});
const providerPurchase=Object.freeze({
  provider:'stripe_web',environment:'sandbox',providerSubscriptionId:'sub_1',
  providerCheckoutId:'cs_1',verification:'provider_confirmed',
});
const base=()=>({authenticatedOwnerId:'owner_a',checkoutAttempt,providerPurchase});
const check=patch=>authorize({...base(),...patch});

test('only matching server checkout and provider-verified purchase may be prebound',()=>{
  assert.deepEqual(check(),{status:'eligible_for_transaction',binding:{
    ownerId:'owner_a',provider:'stripe_web',environment:'sandbox',
    providerSubscriptionId:'sub_1',checkoutAttemptId:'10000000-0000-0000-0000-000000000001',
  }});
});
test('cross-account session cannot claim somebody else’s checkout',()=>{
  assert.equal(check({authenticatedOwnerId:'owner_b'}).status,'wrong_owner');
  assert.equal(check({authenticatedOwnerId:''}).status,'invalid');
});
test('webhook metadata and unconfirmed purchase are not sufficient',()=>{
  for(const candidate of [
    {...providerPurchase,verification:'client_claimed',metadata:{ownerId:'owner_a'}},
    {...providerPurchase,verification:undefined},
    {...providerPurchase,providerCheckoutId:'cs_other'},
    {...providerPurchase,providerSubscriptionId:'sub_other'},
    {...providerPurchase,environment:'production'},
    {...providerPurchase,provider:'app_store'},
  ]) assert.equal(check({providerPurchase:candidate}).status,'unverified_purchase');
});
test('only a completed server-owned checkout attempt is eligible',()=>{
  for(const state of ['pending','client_confirmed',null]) {
    assert.equal(check({checkoutAttempt:{...checkoutAttempt,state}}).status,'unverified_purchase');
  }
});
test('previous owner binding is immutable and restore cannot transfer',()=>{
  const previous={ownerId:'owner_a',provider:'stripe_web',environment:'sandbox',providerSubscriptionId:'sub_1'};
  assert.equal(check({existingBinding:previous}).status,'already_bound');
  assert.equal(check({existingBinding:{...previous,ownerId:'owner_b'}}).status,'owner_conflict');
  assert.equal(check({existingBinding:{...previous,providerSubscriptionId:'sub_other'}}).status,'identity_collision');
});
test('forged IDs and unsupported providers cannot become bindings',()=>{
  for(const attempt of [
    {...checkoutAttempt,attemptId:'bad\nid'},
    {...checkoutAttempt,provider:'other'},
    {...checkoutAttempt,ownerId:'owner_b'},
    {...checkoutAttempt,providerCheckoutId:''},
    {...checkoutAttempt,environment:'unknown'},
  ]){
    assert.notEqual(check({checkoutAttempt:attempt}).status,'eligible_for_transaction');
  }
});
test('does not mutate trusted input facts',()=>{
  const before=JSON.stringify(base());
  check();
  assert.equal(JSON.stringify(base()),before);
});
