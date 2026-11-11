import test from 'node:test';
import assert from 'node:assert/strict';
import {createStripeSandboxSecretAdapter} from './stripeSandboxSecretAdapter.mjs';
import {prepareStripeSandboxCheckout} from './stripeCheckoutPreparation.mjs';

const account='acct_1Ua6f8RBJdOnJBog';
const price='price_1UaDovRBJdOnJBog5swb8zpS';
const id='10000000-0000-0000-0000-000000000001';
const checkout={id:'cs_test_123',object:'checkout.session',livemode:false,
  mode:'subscription',status:'open',client_reference_id:id,
  url:'https://checkout.stripe.com/c/pay/cs_test_123'};
const subscription={object:'subscription',id:'sub_test_123',livemode:false,
  customer:'cus_test_123',status:'trialing'};

function setup({merchant=account,overrides={}}={}){
  const calls=[];
  const responses={
    '/v1/account':{id:merchant},
    '/v1/checkout/sessions':checkout,
    '/v1/checkout/sessions/cs_test_123':{...checkout,status:'complete'},
    '/v1/subscriptions/sub_test_123':subscription,...overrides,
  };
  const request=async(url,init)=>{
    calls.push({url,init});
    return {ok:true,json:async()=>responses[new URL(url).pathname]};
  };
  const adapter=createStripeSandboxSecretAdapter({
    secretKey:'sk_test_mock_not_a_real_key_0123456789',
    expectedMerchantAccountId:account,approvedPriceId:price,request,
  });
  return {adapter,calls};
}

const requestShape={
  merchantAccountId:account,idempotencyKey:'allin-v2-checkout-'+id,
  mode:'subscription',line_items:[{price,quantity:1}],
  subscription_data:{trial_period_days:7},client_reference_id:id,
  success_url:'https://allin365.app/billing/success',
  cancel_url:'https://allin365.app/billing/cancel',
};

test('only merchant-scoped sandbox key is accepted',()=>{
  for(const key of ['sk_live_12345678901234567890','pk_test_12345678901234567890','',null]){
    assert.equal(createStripeSandboxSecretAdapter({secretKey:key,
      expectedMerchantAccountId:account,approvedPriceId:price,request:async()=>{}}),null);
  }
});

test('checks Stripe merchant then creates one fixed seven-day checkout',async()=>{
  const {adapter,calls}=setup();
  const session=await adapter.createCheckoutSession(requestShape);
  assert.equal(session.merchantAccountId,account);
  assert.equal(session.id,'cs_test_123');
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://api.stripe.com/v1/account');
  assert.equal(calls[1].url,'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[1].init.method,'POST');
  assert.equal(calls[1].init.headers['Idempotency-Key'],'allin-v2-checkout-'+id);
  const body=new URLSearchParams(calls[1].init.body);
  assert.equal(body.get('subscription_data[trial_period_days]'),'7');
  assert.equal(body.get('line_items[0][price]'),price);
  assert.equal(body.get('line_items[0][quantity]'),'1');
  assert.equal(body.get('client_reference_id'),id);
  assert.equal(body.get('metadata[ownerId]'),null);
});

test('Stripe account mismatch fails before checkout creation or retrieval',async()=>{
  const {adapter,calls}=setup({merchant:'acct_different'});
  await assert.rejects(()=>adapter.createCheckoutSession(requestShape),/merchant_mismatch/);
  assert.equal(calls.length,1);
  await assert.rejects(()=>adapter.retrieveCheckoutSession('cs_test_123'),/merchant_mismatch/);
  await assert.rejects(()=>adapter.retrieveSubscription('sub_test_123'),/merchant_mismatch/);
  assert.equal(calls.length,3);
});

test('unapproved price, trial changes and forged idempotency are rejected before HTTP',async()=>{
  const {adapter,calls}=setup();
  for(const input of [
    {...requestShape,line_items:[{price:'price_15dollars',quantity:1}]},
    {...requestShape,subscription_data:{trial_period_days:14}},
    {...requestShape,idempotencyKey:'allin-v2-checkout-'+
      '20000000-0000-0000-0000-000000000002'},
    {...requestShape,line_items:[{price,quantity:2}]},
    {...requestShape,success_url:'http://localhost/redirect'},
    {...requestShape,client_reference_id:'not-uuid'},
  ]){
    await assert.rejects(()=>adapter.createCheckoutSession(input));
  }
  assert.equal(calls.length,0);
});

test('checked current Checkout and Subscription require correct ID and sandbox mode',async()=>{
  const {adapter,calls}=setup();
  assert.equal((await adapter.retrieveCheckoutSession('cs_test_123')).id,'cs_test_123');
  assert.equal((await adapter.retrieveSubscription('sub_test_123')).id,'sub_test_123');
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),[
    '/v1/account','/v1/checkout/sessions/cs_test_123',
    '/v1/account','/v1/subscriptions/sub_test_123',
  ]);
  for(const overrides of [
    {'/v1/checkout/sessions/cs_test_123':{...checkout,livemode:true}},
    {'/v1/checkout/sessions/cs_test_123':{...checkout,id:'cs_other'}},
  ]){
    const bad=setup({overrides});
    await assert.rejects(()=>bad.adapter.retrieveCheckoutSession('cs_test_123'));
  }
  const bad=setup({overrides:{'/v1/subscriptions/sub_test_123':{...subscription,livemode:true}}});
  await assert.rejects(()=>bad.adapter.retrieveSubscription('sub_test_123'));
});

test('mock adapter composes with pending checkout helper without producing real network requests',async()=>{
  const {adapter,calls}=setup();
  const result=await prepareStripeSandboxCheckout({
    authenticatedOwnerId:'00000000-0000-0000-0000-000000000001',
    expectedOwnerId:'00000000-0000-0000-0000-000000000001',
    attemptId:id,trialEligible:true,
    priceId:price,expectedMerchantAccountId:account,
    createCheckoutSession:adapter.createCheckoutSession,
    reserveCheckoutAttempt:async()=> 'reserved',
    registerPendingCheckout:async()=> 'pending',
    successUrl:requestShape.success_url,cancelUrl:requestShape.cancel_url,
    approvedReturnOrigin:'https://allin365.app',
  });
  assert.equal(result.status,'pending_checkout_ready');
  assert.equal(calls.length,2);
});

test('provider failures and malformed HTTP replies never create checkout',async()=>{
  for(const request of [
    async()=>{throw Error('offline');},
    async()=>({ok:false,json:async()=>({error:{message:'secret'}})}),
    async()=>({ok:true,json:async()=>{throw Error('non JSON')}}),
    async()=>({ok:true,json:async()=>null}),
  ]){
    const adapter=createStripeSandboxSecretAdapter({
      secretKey:'sk_test_mock_not_a_real_key_0123456789',
      expectedMerchantAccountId:account,approvedPriceId:price,request,
    });
    await assert.rejects(()=>adapter.createCheckoutSession(requestShape));
    await assert.rejects(()=>adapter.retrieveSubscription('sub_test_123'));
  }
});

test('no cross-account header or customer metadata are sent by checkout adapter',async()=>{
  const {adapter,calls}=setup();
  await adapter.createCheckoutSession(requestShape);
  assert.equal(calls[1].init.headers['Stripe-Account'],undefined);
  assert.equal(new URLSearchParams(calls[1].init.body).get('metadata[ownerId]'),null);
  assert.equal(calls[1].init.headers.Authorization.startsWith('Bearer sk_test_'),true);
});
