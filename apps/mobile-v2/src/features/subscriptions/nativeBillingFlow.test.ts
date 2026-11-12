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

import {createNativeBillingFlow} from './nativeBillingFlow.ts';
const owner='00000000-0000-0000-0000-000000000001';
const productId='allin365.monthly';
const iosEvidence={platform:'ios',productId,signedTransaction:'signed.transaction.value'};
const androidEvidence={platform:'android',productId,purchaseToken:'purchase-token-1234'};
const make=(platform='ios',opts={})=>{
 let activeOwner=owner;
 const evidence=platform==='ios'?iosEvidence:androidEvidence;
 const store={platform,getProducts:async()=>[{id:productId}],
  purchase:async()=>evidence,restore:async()=>[evidence]};
 const server={submitEvidence:async()=> 'verified',
  readOwnerEntitlement:async()=>({entitled:true})};
 return {flow:createNativeBillingFlow({platform,productId,store,server,
   getAuthenticatedOwner:()=>activeOwner,...opts}),
   setOwner:v=>{activeOwner=v;}};
};
test('standard five-group owner UUID is accepted, truncated four-group identity is denied',async()=>{
 assert.equal(await make('ios').flow.purchase(),'server_entitled');
 const malformed='00000000-0000-0000-000000000001';
 assert.equal(await make('ios',{getAuthenticatedOwner:()=>malformed}).flow.purchase(),
  'wrong_account');
});
test('iOS verified purchase needs server acceptance and fresh entitlement',async()=>{
 assert.equal(await make('ios').flow.purchase(),'server_entitled');
 assert.equal(await make('ios',{server:{
  submitEvidence:async()=> 'rejected',
  readOwnerEntitlement:async()=>({entitled:true})}}).flow.purchase(),
  'verification_unavailable');
});
test('Google Play purchase callback is never local entitlement',async()=>{
 assert.equal(await make('android',{server:{
  submitEvidence:async()=> 'verified',
  readOwnerEntitlement:async()=>({entitled:false})}}).flow.purchase(),
  'not_entitled');
});
test('restore re-verifies evidence and checks owner',async()=>{
 assert.equal(await make('ios').flow.restore(),'server_entitled');
 assert.equal(await make('android').flow.restore(),'server_entitled');
});
test('missing store, SKU, canceled purchase and mismatched receipt fail safely',async()=>{
 assert.equal(await make('ios',{store:null}).flow.purchase(),'needs_setup');
 assert.equal(await make('ios',{productId:''}).flow.purchase(),'needs_setup');
 assert.equal(await make('ios',{store:{
  platform:'ios',getProducts:async()=>[{id:productId}],
  purchase:async()=>null,restore:async()=>[]}}).flow.purchase(),'canceled');
 assert.equal(await make('ios',{store:{
  platform:'ios',getProducts:async()=>[{id:productId}],
  purchase:async()=>androidEvidence,restore:async()=>[androidEvidence],
 }}).flow.purchase(),'verification_unavailable');
});
test('account switching mid-flight prevents cross-account completion',async()=>{
 let release;
 let ownerNow=owner;
 const store={platform:'ios',getProducts:async()=>[{id:productId}],
  purchase:async()=>new Promise(resolve=>{release=resolve;}),
  restore:async()=>[]};
 const server={submitEvidence:async()=> 'verified',
  readOwnerEntitlement:async()=>({entitled:true})};
 const flow=createNativeBillingFlow({platform:'ios',productId,store,server,
  getAuthenticatedOwner:()=>ownerNow});
 const task=flow.purchase();
 await waitForCheckpoint(()=>release,'release');
 ownerNow='00000000-0000-0000-0000-000000000002';
 release(iosEvidence);
 assert.equal(await task,'wrong_account');
});
test('simultaneous purchase attempts cannot launch duplicate store sessions',async()=>{
 let release;
 const store={platform:'ios',getProducts:async()=>[{id:productId}],
  purchase:async()=>new Promise(resolve=>{release=resolve;}),
  restore:async()=>[]};
 const server={submitEvidence:async()=> 'verified',
  readOwnerEntitlement:async()=>({entitled:true})};
 const flow=createNativeBillingFlow({platform:'ios',productId,store,server,
  getAuthenticatedOwner:()=>owner});
 const first=flow.purchase();
 assert.equal(await flow.purchase(),'purchase_pending');
 await waitForCheckpoint(()=>release,'release');
 release(iosEvidence);
 assert.equal(await first,'server_entitled');
});

test('restore with no receipts preserves wrong-account outcome after entitlement lookup',async()=>{
 let currentOwner=owner;
 let releaseRead;
 const flow=createNativeBillingFlow({
  platform:'ios',productId,
  store:{platform:'ios',getProducts:async()=>[{id:productId}],
   purchase:async()=>null,restore:async()=>[]},
  server:{submitEvidence:async()=> 'verified',
   readOwnerEntitlement:async()=>new Promise(resolve=>{releaseRead=resolve;})},
  getAuthenticatedOwner:()=>currentOwner,
 });
 const restoration=flow.restore();
 await waitForCheckpoint(()=>releaseRead,'releaseRead');
 currentOwner='00000000-0000-0000-0000-000000000002';
 releaseRead({entitled:true});
 assert.equal(await restoration,'wrong_account');
});

test('restore without store purchases respects canonical entitlement for same owner',async()=>{
 const flow=createNativeBillingFlow({
  platform:'android',productId,
  store:{platform:'android',getProducts:async()=>[{id:productId}],
   purchase:async()=>null,restore:async()=>[]},
  server:{submitEvidence:async()=> 'rejected',
   readOwnerEntitlement:async()=>({entitled:false})},
  getAuthenticatedOwner:()=>owner,
 });
 assert.equal(await flow.restore(),'not_entitled');
});

test('finishing a verified transaction never returns prior account entitlement after switch',async()=>{
 let currentOwner=owner;
 let releaseFinish;
 const store={
  platform:'ios',
  getProducts:async()=>[{id:productId}],
  purchase:async()=>iosEvidence,
  restore:async()=>[iosEvidence],
  finishVerifiedPurchase:async()=>new Promise(resolve=>{releaseFinish=resolve;}),
 };
 const flow=createNativeBillingFlow({platform:'ios',productId,store,
  server:{
   submitEvidence:async()=> 'verified',
   readOwnerEntitlement:async()=>({entitled:true}),
  },getAuthenticatedOwner:()=>currentOwner,
 });
 const task=flow.purchase();
 await waitForCheckpoint(()=>releaseFinish,'releaseFinish');
 currentOwner='00000000-0000-0000-0000-000000000002';
 releaseFinish();
 assert.equal(await task,'wrong_account');
});

test('transport failure after switching accounts is classified as wrong_account',async()=>{
 let currentOwner=owner;
 let rejectEvidence;
 const store={
  platform:'ios',
  getProducts:async()=>[{id:productId}],
  purchase:async()=>iosEvidence,
  restore:async()=>[iosEvidence],
 };
 const flow=createNativeBillingFlow({platform:'ios',productId,store,
  server:{
   submitEvidence:async()=>new Promise((resolve,reject)=>{rejectEvidence=reject;}),
   readOwnerEntitlement:async()=>({entitled:true}),
  },getAuthenticatedOwner:()=>currentOwner,
 });
 const task=flow.purchase();
 await waitForCheckpoint(()=>rejectEvidence,'rejectEvidence');
 currentOwner='00000000-0000-0000-0000-000000000002';
 rejectEvidence(Error('service down'));
 assert.equal(await task,'wrong_account');
});

test('store cancellation after account switch reports wrong_account, not canceled',async()=>{
 let currentOwner=owner;
 let completePurchase;
 const store={
  platform:'ios',
  getProducts:async()=>[{id:productId}],
  purchase:async()=>new Promise(resolve=>{completePurchase=resolve;}),
  restore:async()=>[],
 };
 const flow=createNativeBillingFlow({platform:'ios',productId,store,
  server:{submitEvidence:async()=> 'rejected',
    readOwnerEntitlement:async()=>({entitled:false})},
  getAuthenticatedOwner:()=>currentOwner,
 });
 const task=flow.purchase();
 await waitForCheckpoint(()=>completePurchase,'completePurchase');
 currentOwner='00000000-0000-0000-0000-000000000002';
 completePurchase(null);
 assert.equal(await task,'wrong_account');
});

test('store restore transport error after owner switch reports wrong_account',async()=>{
 let currentOwner=owner;
 let rejectRestore;
 const store={
  platform:'ios',
  getProducts:async()=>[{id:productId}],
  purchase:async()=>null,
  restore:async()=>new Promise((resolve,reject)=>{rejectRestore=reject;}),
 };
 const flow=createNativeBillingFlow({platform:'ios',productId,store,
  server:{submitEvidence:async()=> 'rejected',
    readOwnerEntitlement:async()=>({entitled:false})},
  getAuthenticatedOwner:()=>currentOwner,
 });
 const task=flow.restore();
 await waitForCheckpoint(()=>rejectRestore,'rejectRestore');
 currentOwner='00000000-0000-0000-0000-000000000002';
 rejectRestore(Error('store unavailable'));
 assert.equal(await task,'wrong_account');
});
