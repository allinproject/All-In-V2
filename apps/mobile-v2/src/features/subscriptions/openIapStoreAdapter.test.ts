import test from 'node:test';
import assert from 'node:assert/strict';

/** Yield to the event loop and fail visibly if mocked I/O never reaches its
 * expected checkpoint; microtask-only polling can starve Node's timers. */
async function waitForCheckpoint(ready:()=>unknown, label:string){
 for(let attempt=0;attempt<100;attempt++){
  if(ready())return;
  await new Promise<void>(resolve=>setTimeout(resolve,5));
 }
 assert.fail('Native billing test checkpoint was never reached: '+label);
}

import {createOpenIapStoreAdapter} from './openIapStoreAdapter.ts';
import {createNativeBillingFlow} from './nativeBillingFlow.ts';
const owner='00000000-0000-0000-0000-000000000001';
const productId='allin365.monthly';
const signed='eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const hash='a'.repeat(64);
function harness(platform='ios'){
 let currentOwner=owner,success=null,error=null,launch=null,finished=0;
 const purchase=platform==='ios'?
  {store:'apple',productId,purchaseToken:signed}:
  {store:'google',productId,purchaseToken:'play-token-123',purchaseState:'purchased'};
 const api={
  initConnection:async()=>true,
  fetchProducts:async()=>[{id:productId,subscriptionOffers:[{
    basePlanIdAndroid:'monthly',offerTokenAndroid:'approved-offer-token',
  }]}],
  purchaseUpdatedListener:fn=>{success=fn;return {remove:()=>{success=null}}},
  purchaseErrorListener:fn=>{error=fn;return {remove:()=>{error=null}}},
  requestPurchase:async input=>{launch=input;queueMicrotask(()=>success?.(purchase));},
  getAvailablePurchases:async()=>[purchase],
  finishTransaction:async()=>{finished++},
 };
 const store=createOpenIapStoreAdapter({
  platform,productId,api,getOwner:()=>currentOwner,timeoutMs:500,
  getAccountContext:async()=>({
    ownerId:currentOwner,
    ios:{productId,appAccountToken:currentOwner},
    android:{productId,basePlanId:'monthly',obfuscatedAccountId:hash},
  }),
 });
 return {store,api,purchase,setOwner:v=>{currentOwner=v},
  launch:()=>launch,finished:()=>finished};
}
test('iOS store listener returns signed JWS and exact account token only',async()=>{
 const h=harness('ios');
 await h.store.getProducts([productId]);
 const receipt=await h.store.purchase(productId);
 assert.deepEqual(receipt,{platform:'ios',productId,signedTransaction:signed});
 assert.equal(h.launch().type,'subs');
 assert.deepEqual(h.launch().request.apple,{sku:productId,appAccountToken:owner});
 assert.equal(h.finished(),0);
 await h.store.finishVerifiedPurchase(receipt);
 assert.equal(h.finished(),1);
});
test('Android store listener picks only approved base plan offer and obfuscated owner',async()=>{
 const h=harness('android');
 await h.store.getProducts([productId]);
 const receipt=await h.store.purchase(productId);
 assert.deepEqual(receipt,{platform:'android',productId,purchaseToken:'play-token-123'});
 assert.deepEqual(h.launch().request.google,{
  skus:[productId],
  subscriptionOffers:[{sku:productId,offerToken:'approved-offer-token'}],
  obfuscatedAccountId:hash,
 });
});
test('native flow finishes only AFTER server verification and current entitlement',async()=>{
 const h=harness('android');
 const flow=createNativeBillingFlow({
  platform:'android',productId,store:h.store,
  server:{
    submitEvidence:async()=> 'verified',
    readOwnerEntitlement:async()=>({entitled:true}),
  },getAuthenticatedOwner:()=>owner,
 });
 assert.equal(await flow.purchase(),'server_entitled');
 assert.equal(h.finished(),1);
});
test('failed server verification never finishes store transaction',async()=>{
 const h=harness('ios');
 const flow=createNativeBillingFlow({
  platform:'ios',productId,store:h.store,
  server:{
    submitEvidence:async()=> 'rejected',
    readOwnerEntitlement:async()=>({entitled:true}),
  },getAuthenticatedOwner:()=>owner,
 });
 assert.equal(await flow.purchase(),'verification_unavailable');
 assert.equal(h.finished(),0);
});
test('restore reads available purchases but still requires owner-bound server verification',async()=>{
 const h=harness('ios');
 const found=await h.store.restore();
 assert.equal(found.length,1);
 assert.deepEqual(found[0],{platform:'ios',productId,signedTransaction:signed});
 assert.equal(h.finished(),0);
});
test('owner mismatches do not accept a forged native context',async()=>{
  const h=harness('ios');
  h.setOwner('00000000-0000-0000-0000-000000000002');
  await h.store.getProducts([productId]);
  const receipt=await h.store.purchase(productId);
  // The server still validates Apple appAccountToken from signed JWS; native
  // purchase callback never grants access on its own.
  assert.equal(receipt.platform,'ios');
  assert.equal(h.finished(),0);
});

test('owner switch while subscription catalog loads cannot open a native purchase',async()=>{
 let currentOwner=owner;
 let releaseProducts;
 let launches=0;
 const api={
  initConnection:async()=>true,
  fetchProducts:async()=>new Promise(resolve=>{releaseProducts=resolve;}),
  purchaseUpdatedListener:()=>({remove(){}}),
  purchaseErrorListener:()=>({remove(){}}),
  requestPurchase:async()=>{launches++},
  getAvailablePurchases:async()=>[],
  finishTransaction:async()=>{},
 };
 const store=createOpenIapStoreAdapter({
  platform:'ios',productId,api,getOwner:()=>currentOwner,
  getAccountContext:async()=>({ownerId:owner,
   ios:{productId,appAccountToken:owner}}),
 });
 const task=store.purchase(productId);
 await waitForCheckpoint(()=>releaseProducts,'releaseProducts');
 currentOwner='00000000-0000-0000-0000-000000000002';
 releaseProducts([{id:productId}]);
 await assert.rejects(task,/owner_changed/);
 assert.equal(launches,0);
});

test('native purchase callback after owner switch cannot produce signed evidence',async()=>{
 let currentOwner=owner;
 let sendPurchase;
 let launches=0;
 const api={
  initConnection:async()=>true,
  fetchProducts:async()=>[{id:productId}],
  purchaseUpdatedListener:fn=>{sendPurchase=fn;return {remove(){}}},
  purchaseErrorListener:()=>({remove(){}}),
  requestPurchase:async()=>{launches++},
  getAvailablePurchases:async()=>[],
  finishTransaction:async()=>{},
 };
 const store=createOpenIapStoreAdapter({
  platform:'ios',productId,api,getOwner:()=>currentOwner,timeoutMs:500,
  getAccountContext:async()=>({ownerId:owner,
   ios:{productId,appAccountToken:owner}}),
 });
 const task=store.purchase(productId);
 await waitForCheckpoint(()=>sendPurchase,'sendPurchase');
 currentOwner='00000000-0000-0000-0000-000000000002';
 sendPurchase({store:'apple',productId,purchaseToken:signed});
 await assert.rejects(task,/owner_changed/);
 assert.equal(launches,1);
});

test('store discovery may return null without creating a purchase entitlement',async()=>{
 const h=harness('ios');
 h.api.fetchProducts=async()=>null;
 assert.deepEqual(await h.store.getProducts([productId]),[]);
});

test('restore account switch during store lookup rejects receipts before storing evidence',async()=>{
 let currentOwner=owner;
 let releaseRestore;
 const api={
  initConnection:async()=>true,
  fetchProducts:async()=>[{id:productId}],
  purchaseUpdatedListener:()=>({remove(){}}),
  purchaseErrorListener:()=>({remove(){}}),
  requestPurchase:async()=>{},
  getAvailablePurchases:async()=>new Promise(resolve=>{releaseRestore=resolve;}),
  finishTransaction:async()=>{},
 };
 const store=createOpenIapStoreAdapter({
  platform:'ios',productId,api,getOwner:()=>currentOwner,
  getAccountContext:async()=>({ownerId:owner,ios:{productId,appAccountToken:owner}}),
 });
 const task=store.restore();
 await waitForCheckpoint(()=>releaseRestore,'releaseRestore');
 currentOwner='00000000-0000-0000-0000-000000000002';
 releaseRestore([{store:'apple',productId,purchaseToken:signed}]);
 await assert.rejects(task,/owner_changed/);
 await assert.rejects(
  store.finishVerifiedPurchase({platform:'ios',productId,signedTransaction:signed}),
  /native_transaction_not_found/
 );
});

test('previous owner verified purchase cannot be finished by a new account',async()=>{
 const h=harness('ios');
 const receipt=(await h.store.restore())[0];
 h.setOwner('00000000-0000-0000-0000-000000000002');
 await assert.rejects(h.store.finishVerifiedPurchase(receipt),/owner_changed/);
 assert.equal(h.finished(),0);
});
