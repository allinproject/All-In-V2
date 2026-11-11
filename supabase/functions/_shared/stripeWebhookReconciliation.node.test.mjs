import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {reconcileStripeSandboxWebhook as reconcile} from './stripeWebhookReconciliation.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const enc=new TextEncoder(),secret='whsec_mock1234',now=1794410000;
const sub={id:'sub_test_1',object:'subscription',livemode:false,
  customer:'cus_test_1',status:'active'};
const checkout={id:'cs_test_1',object:'checkout.session',livemode:false,
  subscription:'sub_test_1'};
const base=()=>({
  webhookSecrets:[secret],nowSeconds:now,
  retrieveCheckoutSession:async()=>checkout,
  retrieveSubscription:async()=>sub,
  commitAuthoritativeReconciliation:async()=> 'committed',
});
async function signed(type='customer.subscription.updated',objectId='sub_test_1'){
  const event={object:'event',id:'evt_test_1',livemode:false,created:now,
    type,data:{object:{id:objectId,metadata:{ownerId:'forged'}}}};
  const rawBody=enc.encode(JSON.stringify(event));
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{
    name:'HMAC',hash:'SHA-256'},false,['sign']);
  const prefix=enc.encode(now+'.'),bytes=new Uint8Array(prefix.length+rawBody.length);
  bytes.set(prefix);bytes.set(rawBody,prefix.length);
  const signature=Array.from(new Uint8Array(
    await crypto.subtle.sign('HMAC',key,bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  return {rawBody,signatureHeader:'t='+now+',v1='+signature};
}
test('signed subscription event reloads current Stripe state before trusted commit',async()=>{
  const order=[];
  const result=await reconcile({...base(),...await signed(),
    retrieveSubscription:async id=>{order.push('stripe');assert.equal(id,'sub_test_1');return sub;},
    commitAuthoritativeReconciliation:async entry=>{
      order.push('commit');assert.equal(entry.providerEventId,'evt_test_1');
      assert.equal(entry.currentProviderSubscription,sub);
      assert.equal('ownerId' in entry,false);
      return 'committed';
    }});
  assert.deepEqual(result,{status:200,code:'accepted'});
  assert.deepEqual(order,['stripe','commit']);
});
test('checkout completion retrieves checkout then current subscription',async()=>{
  const order=[];
  const result=await reconcile({...base(),...await signed('checkout.session.completed','cs_test_1'),
    retrieveCheckoutSession:async()=>{order.push('checkout');return checkout;},
    retrieveSubscription:async()=>{order.push('subscription');return sub;},
    commitAuthoritativeReconciliation:async()=>{order.push('commit');return 'committed';}});
  assert.equal(result.status,200);
  assert.deepEqual(order,['checkout','subscription','commit']);
});
test('invalid signatures never touch provider nor persistence',async()=>{
  let calls=0;
  const e=await signed();
  const result=await reconcile({...base(),...e,signatureHeader:'t='+now+',v1='+'0'.repeat(64),
    retrieveSubscription:async()=>{calls++;return sub;},
    commitAuthoritativeReconciliation:async()=>{calls++;return 'committed';}});
  assert.equal(result.status,400);
  assert.equal(calls,0);
});
test('provider identity or mode mismatch cannot result in ledger updates',async()=>{
  for(const current of [{...sub,id:'sub_other'},{...sub,livemode:true},
    {...sub,customer:null},{...sub,object:'invoice'}]){
    let calls=0;
    const result=await reconcile({...base(),...await signed(),
      retrieveSubscription:async()=>current,
      commitAuthoritativeReconciliation:async()=>{calls++;return 'committed';}});
    assert.equal(result.status,503);
    assert.equal(calls,0);
  }
});
test('persistence errors, unknown purchase and duplicate delivery all handled',async()=>{
  const event=await signed();
  for(const commitAuthoritativeReconciliation of [
    async()=>{throw Error('DB error including private details')},
    async()=> 'unknown_purchase',
  ]) {
    const r=await reconcile({...base(),...event,commitAuthoritativeReconciliation});
    assert.deepEqual(r,{status:503,code:'persistence_unavailable'});
  }
  assert.deepEqual(await reconcile({...base(),...event,
    commitAuthoritativeReconciliation:async()=> 'duplicate'}),
    {status:200,code:'accepted'});
});
test('signed unrelated events ignored but unimplemented invoice events retry',async()=>{
  assert.deepEqual(await reconcile({...base(),...await signed('customer.created','cus_test_1')}),
    {status:200,code:'ignored'});
  assert.deepEqual(await reconcile({...base(),...await signed('invoice.paid','in_test_1')}),
    {status:503,code:'unsupported_event'});
});
