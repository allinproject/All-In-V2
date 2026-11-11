import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStripeCurrentState } from './stripeCurrentSubscription.mjs';

const priceId = 'price_1UaDovRBJdOnJBog5swb8zpS';
const productId = 'prod_VbQgPefruseFHU';
const current = {
  object:'subscription', id:'sub_1234', livemode:false, customer:'cus_1234',
  status:'trialing', trial_end:1795000000,
  items:{data:[{quantity:1, current_period_end:1797000000,
    price:{id:priceId,product:productId,currency:'usd',unit_amount:999,
      type:'recurring',recurring:{interval:'month',interval_count:1}}}]},
};
const envelope = {status:'authenticated_envelope',eventId:'evt_1234',liveMode:false};
const base=()=>({
  authenticatedEnvelope:envelope,subscriptionId:'sub_1234',
  retrieveSubscription:async()=>current,
  resolveOwner:async()=> 'owner_a',
  serverRevision:1,approvedPriceId:priceId,approvedProductId:productId,
  expectedLiveMode:false,
});
const run=(patch={})=>reconcileStripeCurrentState({...base(),...patch});

test('verified trial uses current provider trial end, not client trial claim',async()=>{
  const r=await run();
  assert.deepEqual(r,{status:'verified_for_transaction',fact:{
    ownerId:'owner_a',provider:'stripe_web',providerSubscriptionId:'sub_1234',
    providerEventId:'evt_1234',revision:1,phase:'trial',accessUntil:1795000000000,
  }});
});

test('active paid and cancel-at-period-end respect verified paid-through cutoff',async()=>{
  for(const [cancel,phase] of [[false,'paid'],[true,'canceling']]){
    const subscription={...current,status:'active',cancel_at_period_end:cancel};
    const r=await run({retrieveSubscription:async()=>subscription});
    assert.equal(r.status,'verified_for_transaction');
    assert.equal(r.fact.phase,phase);
    assert.equal(r.fact.accessUntil,1797000000000);
  }
});

test('failed payment and canceled statuses cannot grant paid time',async()=>{
  for(const [status,phase] of [
    ['past_due','billing_retry'],['unpaid','billing_retry'],
    ['incomplete','billing_retry'],['canceled','expired'],
    ['paused','expired'],['incomplete_expired','expired']]){
    const r=await run({retrieveSubscription:async()=>({...current,status})});
    assert.equal(r.status,'verified_for_transaction');
    assert.equal(r.fact.phase,phase);
    assert.equal(r.fact.accessUntil,null);
  }
});

test('unknown status or missing trial/paid period fails closed',async()=>{
  for(const subscription of [
    {...current,status:'ghost'},
    {...current,trial_end:null},
    {...current,status:'active',items:{data:[{...current.items.data[0],current_period_end:null}]}},
  ]) {
    const r=await run({retrieveSubscription:async()=>subscription});
    assert.notEqual(r.status,'verified_for_transaction');
  }
});

test('wrong price, product, quantity, amount, interval or currency are denied',async()=>{
  const item=current.items.data[0];
  for(const candidate of [
    {...item,price:{...item.price,id:'price_15dollars'}},
    {...item,price:{...item.price,product:'prod_wrong'}},
    {...item,price:{...item.price,unit_amount:1500}},
    {...item,price:{...item.price,currency:'eur'}},
    {...item,price:{...item.price,recurring:{interval:'year',interval_count:1}}},
    {...item,quantity:2},
  ]) {
    const r=await run({retrieveSubscription:async()=>({...current,items:{data:[candidate]}})});
    assert.equal(r.status,'unapproved_offer');
  }
});

test('wrong environment, merchant object and incomplete subscription list denied',async()=>{
  for(const subscription of [
    {...current,livemode:true},
    {...current,id:'sub_other'},
    {...current,object:'invoice'},
    {...current,customer:null},
    {...current,items:{data:[]}},
    {...current,items:{data:[current.items.data[0],current.items.data[0]]}},
  ]) {
    const r=await run({retrieveSubscription:async()=>subscription});
    assert.equal(r.status,'provider_mismatch');
  }
});

test('provider lookup exceptions, wrong owner and unsigned envelope fail closed',async()=>{
  assert.equal((await run({retrieveSubscription:async()=>{throw Error('Stripe down')}})).status,
    'provider_unavailable');
  for(const owner of [null,'',' owner_a']){
    const r=await run({resolveOwner:async()=>owner});
    assert.equal(r.status,'owner_unresolved');
  }
  assert.equal((await run({resolveOwner:async()=>{throw Error('DB unavailable')}})).status,
    'owner_unresolved');
  assert.equal((await run({authenticatedEnvelope:{...envelope,status:'claimed'}})).status,
    'invalid_request');
  assert.equal((await run({serverRevision:0})).status,'invalid_request');
});

test('never trusts Stripe metadata owner identity',async()=>{
  const r=await run({retrieveSubscription:async()=>({...current,metadata:{ownerId:'victim'}})});
  assert.equal(r.fact.ownerId,'owner_a');
  assert.equal('customer' in r.fact,false);
  assert.equal('metadata' in r.fact,false);
});
