import test from 'node:test';
import assert from 'node:assert/strict';
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
 while(!release)await Promise.resolve();
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
 while(!release)await Promise.resolve();
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
 while(!releaseRead)await Promise.resolve();
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
 while(!releaseFinish)await Promise.resolve();
 currentOwner='00000000-0000-0000-0000-000000000002';
 releaseFinish();
 assert.equal(await task,'wrong_account');
});
