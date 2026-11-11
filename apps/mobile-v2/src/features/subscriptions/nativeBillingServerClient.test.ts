import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeBillingServerClient} from './nativeBillingServerClient.ts';
const owner='00000000-0000-0000-0000-000000000001',product='allin365.monthly';
const mockContext={code:'native_billing_context',
 ios:{productId:product,appAccountToken:owner},
 android:{productId:'monthly_v2',basePlanId:'monthly',obfuscatedAccountId:'a'.repeat(64)}};
const base=(reply=()=>({data:{code:'verified'},error:null}))=>{
 let active=owner,calls=[];
 const billing=createNativeBillingServerClient({
  getOwner:()=>active,
  client:{invoke:async(name,options)=>{calls.push({name,options});return reply(name,options)}},
 });
 return {billing,calls,setOwner:id=>{active=id}};
};
test('owner-bound native context returns Apple token and privacy-preserving Google account',async()=>{
 const h=base(()=>({data:mockContext,error:null}));
 const result=await h.billing.getAccountContext();
 assert.equal(result.ownerId,owner);
 assert.equal(result.ios.appAccountToken,owner);
 assert.equal(result.android.obfuscatedAccountId,'a'.repeat(64));
 assert.deepEqual(h.calls.map(c=>c.name),['v2-native-subscription-verify']);
 assert.equal(h.calls[0].options.method,'GET');
});
test('only signed Apple or Google purchase evidence is posted, never ownerId',async()=>{
 const h=base();
 assert.equal(await h.billing.submitEvidence({ownerId:owner,
  evidence:{platform:'ios',productId:product,signedTransaction:'signed-jws'}}),'verified');
 assert.equal(await h.billing.submitEvidence({ownerId:owner,
  evidence:{platform:'android',productId:'monthly_v2',purchaseToken:'raw-token'}}),'verified');
 assert.deepEqual(h.calls.map(c=>c.options.body),[
  {platform:'ios',signedTransaction:'signed-jws'},
  {platform:'android',purchaseToken:'raw-token'},
 ]);
 assert.equal(JSON.stringify(h.calls).includes('ownerId'),false);
});
test('change of signed-in user rejects native purchase response',async()=>{
 let current=owner;
 const h=createNativeBillingServerClient({
   getOwner:()=>current,
   client:{invoke:async()=>{current='00000000-0000-0000-0000-000000000002';
     return {data:{code:'verified'}}}},
 });
 assert.equal(await h.submitEvidence({ownerId:owner,
   evidence:{platform:'ios',productId:product,signedTransaction:'signed-jws'}}),
   'rejected');
});
test('unavailable current entitlement never implies paid status',async()=>{
 for(const response of [
  {data:{entitled:true},error:{message:'backend error'}},
  {data:{code:'entitlement_disabled'},error:null},
  {data:{entitled:'yes'},error:null},
 ]){
  const h=base(()=>response);
  await assert.rejects(()=>h.billing.readOwnerEntitlement(owner));
 }
 const h=base(()=>({data:{entitled:false},error:null}));
 assert.deepEqual(await h.billing.readOwnerEntitlement(owner),{entitled:false});
});
test('fraudulent context and denied pending receipt fail closed',async()=>{
 const bad=base(()=>({data:{...mockContext,
  ios:{...mockContext.ios,appAccountToken:'00000000-0000-0000-0000-000000000002'}}}));
 await assert.rejects(()=>bad.billing.getAccountContext());
 const h=base(()=>({data:{code:'acknowledgement_required'}}));
 assert.equal(await h.billing.submitEvidence({ownerId:owner,
  evidence:{platform:'android',productId:'monthly_v2',purchaseToken:'pending-token'}}),
  'pending');
});
