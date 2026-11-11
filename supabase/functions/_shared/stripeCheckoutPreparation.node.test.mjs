import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStripeSandboxCheckout as prepare } from './stripeCheckoutPreparation.mjs';

const owner='00000000-0000-0000-0000-000000000001';
const attemptId='10000000-0000-0000-0000-000000000001';
const merchant='acct_1Ua6f8RBJdOnJBog';
const session={id:'cs_test_1',livemode:false,mode:'subscription',status:'open',
  merchantAccountId:merchant,client_reference_id:attemptId,
  url:'https://checkout.stripe.com/c/pay/test_123'};
const base=()=>({
  authenticatedOwnerId:owner,expectedOwnerId:owner,attemptId,trialEligible:true,
  priceId:'price_1UaDovRBJdOnJBog5swb8zpS',
  expectedMerchantAccountId:merchant,
  successUrl:'https://allin365.app/billing/success',
  cancelUrl:'https://allin365.app/billing/cancel',
  approvedReturnOrigin:'https://allin365.app',
  createCheckoutSession:async()=>session,
  registerPendingCheckout:async()=> 'pending',
});
const check=patch=>prepare({...base(),...patch});

test('creates only an owner-bound $9.99 monthly seven-day trial request',async()=>{
  let request=null, record=null;
  const r=await check({
    createCheckoutSession:async v=>{request=v;return session;},
    registerPendingCheckout:async v=>{record=v;return 'pending';},
  });
  assert.deepEqual(r,{status:'pending_checkout_ready',checkoutUrl:session.url});
  assert.deepEqual(request,{
    idempotencyKey:'allin-v2-checkout-'+attemptId,
    merchantAccountId:merchant, mode:'subscription',
    line_items:[{price:'price_1UaDovRBJdOnJBog5swb8zpS',quantity:1}],
    subscription_data:{trial_period_days:7},
    client_reference_id:attemptId,
    success_url:'https://allin365.app/billing/success',
    cancel_url:'https://allin365.app/billing/cancel',
  });
  assert.deepEqual(record,{
    attemptId,ownerId:owner,authenticatedOwnerId:owner,
    provider:'stripe_web',environment:'sandbox',providerCheckoutId:'cs_test_1',
  });
});

test('wrong owner, ineligible repeat trial or non-UUID ID cannot create checkout',async()=>{
  let creations=0;
  for(const patch of [
    {expectedOwnerId:'00000000-0000-0000-0000-000000000002'},
    {trialEligible:false},
    {trialEligible:undefined},
    {attemptId:'attempt_client'},
    {authenticatedOwnerId:'owner_claimed'},
    {expectedMerchantAccountId:''},
  ]){
    const r=await check({...patch,createCheckoutSession:async()=>{
      creations++;return session;
    }});
    assert.equal(r.status,'invalid_or_ineligible');
  }
  assert.equal(creations,0);
});

test('rejects unapproved redirect origins including embedded credentials',async()=>{
  for(const patch of [
    {approvedReturnOrigin:'http://allin365.app'},
    {approvedReturnOrigin:'https://allin365.app/extra'},
    {successUrl:'https://phishing.example/success'},
    {successUrl:'http://allin365.app/billing/success'},
    {cancelUrl:'https://user:secret@allin365.app/billing/cancel'},
    {approvedReturnOrigin:'bad'},
  ]){
    assert.equal((await check(patch)).status,'invalid_return_url');
  }
});

test('Stripe merchant, livemode, checkout host and identity are checked',async()=>{
  for(const patch of [
    {merchantAccountId:'acct_other'},
    {livemode:true}, {mode:'payment'}, {status:'complete'},
    {id:'sub_wrong'}, {client_reference_id:'10000000-0000-0000-0000-000000000002'},
    {url:'https://checkout.stripe.com.evil.example/c/pay/fake'},
    {url:'https://another.example/c/pay/fake'},
    {url:'http://checkout.stripe.com/c/pay/fake'},
  ]){
    let writes=0;
    const r=await check({createCheckoutSession:async()=>({...session,...patch}),
      registerPendingCheckout:async()=>{writes++;return 'pending';}});
    assert.equal(r.status,'provider_mismatch');
    assert.equal(writes,0);
  }
});

test('never reveals checkout URL if pending row is unavailable or rejected',async()=>{
  for(const registerPendingCheckout of [
    async()=>{throw Error('database down');},
    async()=> 'identity_collision',
    async()=> 'owner_conflict',
  ]){
    const r=await check({registerPendingCheckout});
    assert.notEqual(r.status,'pending_checkout_ready');
    assert.equal('checkoutUrl' in r,false);
  }
  assert.equal((await check({registerPendingCheckout:async()=> 'already_pending'})).status,
    'pending_checkout_ready');
});

test('provider outages never fake a checkout URL',async()=>{
  const r=await check({createCheckoutSession:async()=>{throw Error('Stripe down');}});
  assert.deepEqual(r,{status:'provider_unavailable'});
});
