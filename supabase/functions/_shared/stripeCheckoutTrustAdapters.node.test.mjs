import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckoutTrustAdapters} from './stripeCheckoutTrustAdapters.mjs';
import {handleStripeSandboxCheckoutRequest} from './stripeCheckoutRequest.mjs';
const owner='00000000-0000-0000-0000-000000000001';
const attemptId='10000000-0000-0000-0000-000000000001';
const goodUser={data:{user:{id:owner,email:'never-leak@example.com',
  user_metadata:{admin:true,trialEligible:true}}},error:null};
const goodRow={data:[{owner_id:owner,attempt_id:attemptId,status:'eligible_reserved',
  trial_eligible:true}],error:null};
const setup=overrides=>createCheckoutTrustAdapters({
  authGetUser:async()=>goodUser,
  claimPrivateTrial:async()=>goodRow,...overrides,
});
test('authenticated identity is derived from trusted Auth response, not editable metadata',async()=>{
  const a=setup();
  assert.deepEqual(await a.authenticateBearer('opaque_token'),{id:owner});
  assert.equal('trialEligible' in await a.authenticateBearer('opaque_token'),false);
});
test('reject invalid Auth, missing user, provider outage and missing dependencies',async()=>{
  assert.equal(createCheckoutTrustAdapters({}),null);
  for(const authGetUser of [
    async()=>({data:{user:{id:'imposter'}},error:null}),
    async()=>({data:{user:{id:owner}},error:{message:'expired'}}),
    async()=>({data:{user:null}}),
    async()=>{throw Error('network')},
  ])assert.equal(await setup({authGetUser}).authenticateBearer('opaque_token'),null);
  assert.equal(await setup().authenticateBearer(''),null);
});
test('maps one owner-bound private claim from canonical SQL columns',async()=>{
  let args;
  const a=setup({claimPrivateTrial:async v=>{args=v;return goodRow;}});
  assert.deepEqual(await a.claimEligibleAttempt({ownerId:owner,provider:'stripe_web',
    environment:'sandbox'}),{status:'eligible_reserved',attemptId,
    ownerId:owner,trialEligible:true});
  assert.deepEqual(args,{p_owner_id:owner,p_authenticated_owner_id:owner,
    p_provider:'stripe_web',p_environment:'sandbox'});
});
test('denies forged owner, multiple SQL rows and invalid trial claims',async()=>{
  for(const data of [
    [{...goodRow.data[0],owner_id:'00000000-0000-0000-0000-000000000002'}],
    [goodRow.data[0],goodRow.data[0]],
    [{...goodRow.data[0],trial_eligible:false}],
    [{...goodRow.data[0],attempt_id:'client_claim'}],
    [],
  ]){
    await assert.rejects(()=>setup({claimPrivateTrial:async()=>({data,error:null})})
      .claimEligibleAttempt({ownerId:owner,provider:'stripe_web',environment:'sandbox'}));
  }
  assert.deepEqual(await setup({claimPrivateTrial:async()=>({data:[{
    status:'trial_ineligible',owner_id:owner,attempt_id:null,trial_eligible:false
  }],error:null})}).claimEligibleAttempt({ownerId:owner,provider:'stripe_web',
    environment:'sandbox'}),{status:'trial_ineligible'});
});
test('checkout request composes with trusted Auth and serialized trial DB result',async()=>{
  const a=setup();
  const response=await handleStripeSandboxCheckoutRequest({
    method:'POST',authorization:'Bearer test_token',
    authenticateBearer:a.authenticateBearer,
    claimEligibleAttempt:a.claimEligibleAttempt,
    reserveCheckoutAttempt:async()=> 'already_reserved',
    createCheckoutSession:async()=>({
      id:'cs_test_123',livemode:false,mode:'subscription',status:'open',
      merchantAccountId:'acct_1Ua6f8RBJdOnJBog',client_reference_id:attemptId,
      url:'https://checkout.stripe.com/c/pay/test_123',
    }),
    registerPendingCheckout:async()=> 'pending',
    priceId:'price_1UaDovRBJdOnJBog5swb8zpS',
    merchantAccountId:'acct_1Ua6f8RBJdOnJBog',
    successUrl:'https://allin365.app/billing/success',
    cancelUrl:'https://allin365.app/billing/cancel',
    approvedReturnOrigin:'https://allin365.app',
  });
  assert.equal(response.status,200);
  assert.equal(response.code,'checkout_ready');
});
