import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmStripeCheckoutForBinding as confirm } from './stripeCheckoutConfirmation.mjs';
import { authorizeVerifiedPurchaseBinding } from './subscriptionPurchaseBinding.mjs';

const priceId='price_1UaDovRBJdOnJBog5swb8zpS';
const productId='prod_VbQgPefruseFHU';
const attempt=Object.freeze({ownerId:'owner_a',attemptId:'10000000-0000-0000-0000-000000000001',
  provider:'stripe_web',environment:'sandbox',
  providerCheckoutId:'cs_test_a',state:'pending'});
const session=Object.freeze({object:'checkout.session',id:'cs_test_a',livemode:false,
  mode:'subscription',status:'complete',payment_status:'no_payment_required',
  customer:'cus_test_a',subscription:'sub_test_a',metadata:{ownerId:'victim'}});
const item=Object.freeze({quantity:1,price:{id:priceId,product:productId,
  currency:'usd',unit_amount:999,type:'recurring',
  recurring:{interval:'month',interval_count:1}}});
const sub=Object.freeze({object:'subscription',id:'sub_test_a',
  livemode:false,customer:'cus_test_a',status:'trialing',
  trial_start:1794400000,trial_end:1795004800,items:{data:[item]}});
const base=()=>({expectedOwnerId:'owner_a',checkoutAttempt:attempt,
  retrieveCheckoutSession:async()=>session,retrieveSubscription:async()=>sub,
  approvedPriceId:priceId,approvedProductId:productId,expectedLiveMode:false});
const run=patch=>confirm({...base(),...patch});

test('provider-confirmed seven-day trial checkout is eligible for server transaction, not entitled',async()=>{
  const result=await run();
  assert.equal(result.status,'confirmed_for_binding_transaction');
  assert.equal(result.attempt.ownerId,'owner_a');
  assert.equal(result.providerPurchase.providerSubscriptionId,'sub_test_a');
  assert.equal('entitlement' in result,false);
  assert.equal('metadata' in result,false);
  const decision=authorizeVerifiedPurchaseBinding({
    authenticatedOwnerId:'owner_a',checkoutAttempt:result.attempt,
    providerPurchase:result.providerPurchase,
  });
  assert.equal(decision.status,'eligible_for_transaction');
});

test('the pending checkout belongs to authenticated account, not session metadata',async()=>{
  assert.equal((await run({expectedOwnerId:'victim'})).status,'invalid_attempt');
  assert.equal((await run({checkoutAttempt:{...attempt,ownerId:'other'}})).status,'invalid_attempt');
  assert.equal((await run({checkoutAttempt:{...attempt,state:'client_confirmed'}})).status,'invalid_attempt');
  assert.equal((await run({checkoutAttempt:{...attempt,attemptId:''}})).status,'invalid_attempt');
});

test('incomplete, unpaid and wrong-mode checkout never confirms purchase',async()=>{
  for(const patch of [{status:'open'},{payment_status:'unpaid'},{mode:'payment'},
    {livemode:true},{object:'invoice'},{subscription:null},{customer:null},
    {id:'cs_another'}]){
    assert.equal((await run({retrieveCheckoutSession:async()=>({...session,...patch})})).status,
      'checkout_unconfirmed');
  }
});

test('subscription merchant, identity, customer and lifecycle must match',async()=>{
  for(const patch of [{id:'sub_other'},{customer:'cus_other'},{livemode:true},
    {status:'canceled'},{status:'past_due'},{object:'invoice'},
    {items:{data:[]}},{items:{data:[item,item]}}]){
    assert.equal((await run({retrieveSubscription:async()=>({...sub,...patch})})).status,
      'subscription_unconfirmed');
  }
});

test('unapproved $15 price, annual plans, quantity or currency are denied',async()=>{
  for(const patch of [
    {id:'price_other'},{product:'prod_wrong'},{unit_amount:1500},{currency:'eur'},
    {recurring:{interval:'year',interval_count:1}},
  ]){
    assert.equal((await run({retrieveSubscription:async()=>({...sub,
      items:{data:[{...item,price:{...item.price,...patch}}]}})})).status,'unapproved_offer');
  }
  assert.equal((await run({retrieveSubscription:async()=>({...sub,
    items:{data:[{...item,quantity:2}]}})})).status,'unapproved_offer');
});

test('an already recorded provider subscription cannot be replaced',async()=>{
  assert.equal((await run({checkoutAttempt:{...attempt,providerSubscriptionId:'sub_other'}})).status,
    'purchase_collision');
  assert.equal((await run({checkoutAttempt:{...attempt,providerSubscriptionId:'sub_test_a'}})).status,
    'confirmed_for_binding_transaction');
});

test('provider outages and missing verifier fail closed without owner binding',async()=>{
  assert.equal((await run({retrieveCheckoutSession:async()=>{throw Error('network')}})).status,
    'provider_unavailable');
  assert.equal((await run({retrieveSubscription:async()=>{throw Error('network')}})).status,
    'provider_unavailable');
  assert.equal((await run({retrieveSubscription:null})).status,'invalid_attempt');
  assert.equal((await run({expectedLiveMode:true})).status,'invalid_attempt');
});

test('trial must last seven days; no unapproved long trial or missing dates',async()=>{
  for (const patch of [
    {trial_start:null},
    {trial_end:null},
    {trial_end:sub.trial_start+30*86400},
    {trial_end:sub.trial_start+6*86400},
  ]) {
    assert.equal((await run({retrieveSubscription:async()=>({...sub,...patch})})).status,
      'unapproved_trial');
  }
  assert.equal((await run({retrieveSubscription:async()=>({...sub,status:'active',
    trial_start:null,trial_end:null})})).status,'confirmed_for_binding_transaction');
});
