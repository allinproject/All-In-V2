import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStripeSandboxCheckoutRequest as handle} from './stripeCheckoutRequest.mjs';

const owner='00000000-0000-0000-0000-000000000001';
const attemptId='10000000-0000-0000-0000-000000000001';
const session={id:'cs_test_1',livemode:false,mode:'subscription',status:'open',
  merchantAccountId:'acct_1Ua6f8RBJdOnJBog',client_reference_id:attemptId,
  url:'https://checkout.stripe.com/c/pay/test_1'};
const original=()=>({
  method:'POST',authorization:'Bearer test_auth_token',rawBody:new Uint8Array(),
  authenticateBearer:async()=>({id:owner}),
  claimEligibleAttempt:async()=>({status:'eligible_reserved',
     attemptId,ownerId:owner,trialEligible:true}),
  reserveCheckoutAttempt:async()=> 'already_reserved',
  createCheckoutSession:async()=>session,
  registerPendingCheckout:async()=> 'pending',
  priceId:'price_1UaDovRBJdOnJBog5swb8zpS',
  merchantAccountId:'acct_1Ua6f8RBJdOnJBog',
  successUrl:'https://allin365.app/billing/success',
  cancelUrl:'https://allin365.app/billing/cancel',
  approvedReturnOrigin:'https://allin365.app',
});
const run=patch=>handle({...original(),...patch});

test('authenticated owner with a committed trial reservation receives only checkout URL',async()=>{
  const callOrder=[];
  const r=await run({
    authenticateBearer:async()=>{callOrder.push('auth');return {id:owner};},
    claimEligibleAttempt:async({ownerId})=>{
      assert.equal(ownerId,owner);callOrder.push('claim');
      return {status:'eligible_reserved',attemptId,ownerId:owner,trialEligible:true};
    },
    reserveCheckoutAttempt:async()=>{callOrder.push('reserve');return 'already_reserved';},
    createCheckoutSession:async()=>{callOrder.push('stripe');return session;},
    registerPendingCheckout:async()=>{callOrder.push('pending');return 'pending';},
  });
  assert.deepEqual(r,{status:200,code:'checkout_ready',checkoutUrl:session.url});
  assert.deepEqual(callOrder,['auth','claim','reserve','stripe','pending']);
});

test('wrong method, body or token never touches Stripe or eligibility',async()=>{
  let calls=0;
  for(const patch of [
    {method:'GET'},{method:'OPTIONS'},{rawBody:new TextEncoder().encode('{"ownerId":"victim"}')},
    {authorization:null},{authorization:'Bearer '},{authorization:'Basic abc'},
    {authorization:'Bearer bad token'},
  ]){
    const r=await run({...patch,claimEligibleAttempt:async()=>{calls++;return null;}});
    assert.notEqual(r.status,200);
  }
  assert.equal(calls,0);
});

test('no user identity, forged owner or missing auth dependencies fail closed',async()=>{
  let calls=0;
  for(const patch of [
    {authenticateBearer:async()=>{throw Error('auth offline');}},
    {authenticateBearer:async()=>({id:'not-a-uuid'})},
    {authenticateBearer:async()=>null},
    {authenticateBearer:null},
  ]){
    assert.equal((await run({...patch,claimEligibleAttempt:async()=>{calls++;}})).status,
      patch.authenticateBearer===null?503:401);
  }
  assert.equal(calls,0);
  const mismatch=await run({claimEligibleAttempt:async()=>({
    status:'eligible_reserved',ownerId:'00000000-0000-0000-0000-000000000002',
    attemptId,trialEligible:true,
  })});
  assert.equal(mismatch.status,503);
});

test('server-side trial ineligibility cannot be bypassed by client request',async()=>{
  const r=await run({claimEligibleAttempt:async()=>({status:'trial_ineligible'})});
  assert.deepEqual(r,{status:409,code:'trial_ineligible'});
  for(const claim of [
    {status:'eligible_reserved',ownerId:owner,attemptId,trialEligible:false},
    {status:'eligible_reserved',ownerId:owner,attemptId:'attempt_client',trialEligible:true},
    {status:'pending',ownerId:owner,attemptId,trialEligible:true},
    null,
  ]){
    assert.equal((await run({claimEligibleAttempt:async()=>claim})).status,503);
  }
});

test('failed checkout/Stripe or missing backend returns generic response without secrets',async()=>{
  for(const patch of [
    {claimEligibleAttempt:async()=>{throw Error('database offline');}},
    {registerPendingCheckout:async()=>{throw Error('postgres internal');}},
    {createCheckoutSession:async()=>{throw Error('Stripe private error');}},
    {reserveCheckoutAttempt:async()=> 'owner_conflict'},
    {registerPendingCheckout:null},
  ]){
    const result=await run(patch);
    assert.equal(result.status,503);
    assert.equal('checkoutUrl' in result,false);
    assert.equal(JSON.stringify(result).includes('private'),false);
  }
});
