import test from 'node:test';
import assert from 'node:assert/strict';
import {projectStripeSandboxSubscription as project} from './stripeSubscriptionProjection.mjs';
const now=1794410000;
const priceId='price_1UaDovRBJdOnJBog5swb8zpS';
const productId='prod_VbQgPefruseFHU';
const sub={
  object:'subscription',id:'sub_test_123',customer:'cus_test_123',
  livemode:false,status:'active',cancel_at_period_end:false,cancel_at:null,
  items:{data:[{quantity:1,current_period_end:now+86400*30,
    price:{id:priceId,product:productId,currency:'usd',unit_amount:999,
      type:'recurring',recurring:{interval:'month',interval_count:1}}}]},
};
const run=patch=>project({subscription:{...sub,...patch},
  approvedPriceId:priceId,approvedProductId:productId,nowSeconds:now});
test('active approved $9.99 monthly item is bounded by item-level billing period',()=>{
  const r=run();
  assert.equal(r.status,'verified_state');
  assert.equal(r.phase,'paid');
  assert.equal(r.accessUntil,new Date((now+86400*30)*1000).toISOString());
});
test('trial cannot extend beyond current item period and trial end',()=>{
  const r=run({status:'trialing',trial_end:now+86400*7});
  assert.equal(r.phase,'trial');
  assert.equal(r.accessUntil,new Date((now+86400*7)*1000).toISOString());
  assert.equal(run({status:'trialing',trial_end:null}).status,'unverified_provider_state');
});
test('scheduled cancellation preserves access only to earliest bounded cutoff',()=>{
  const r=run({cancel_at_period_end:true,cancel_at:now+3600});
  assert.equal(r.phase,'canceling');
  assert.equal(r.accessUntil,new Date((now+3600)*1000).toISOString());
});
test('expired, delinquent and canceled provider state cannot grant access',()=>{
  for(const status of ['past_due','unpaid','incomplete','incomplete_expired',
    'paused','canceled']){
    const r=run({status});
    assert.equal(r.status,'verified_state');
    assert.equal(r.accessUntil,null);
  }
  const r=run({items:{data:[{...sub.items.data[0],current_period_end:now-1}]}});
  assert.equal(r.phase,'expired');
  assert.equal(r.accessUntil,null);
});
test('does not fall back to removed subscription-level billing period',()=>{
  const r=run({current_period_end:now+86400*30,
    items:{data:[{...sub.items.data[0],current_period_end:undefined}]}});
  assert.equal(r.status,'unverified_provider_state');
});
test('unapproved offers, additional items, malformed period or live mode rejected',()=>{
  for(const value of [{livemode:true},{items:{data:[]}},
    {items:{data:[sub.items.data[0],sub.items.data[0]]}},
    {items:{data:[{...sub.items.data[0],quantity:2}]}},
    {items:{data:[{...sub.items.data[0],
      price:{...sub.items.data[0].price,unit_amount:1500}}]}},
    {items:{data:[{...sub.items.data[0],
      price:{...sub.items.data[0].price,recurring:{interval:'year',interval_count:1}}}]}},
  ]){
    const r=run(value);
    assert.notEqual(r.status,'verified_state');
  }
});
