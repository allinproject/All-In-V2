import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBillingReleaseGate,prepareNativeBillingRuntime} from './nativeBillingRuntime.ts';

const owner='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const approved=Object.freeze({
  enabled:true,signedNativeBuild:true,
  storeCatalogApproved:true,serverSecurityApproved:true,
});
const context=(id=owner)=>({
  ownerId:id,
  ios:{productId:'allin365.monthly',appAccountToken:id},
  android:{productId:'allin365.monthly',basePlanId:'monthly',
    obfuscatedAccountId:'a'.repeat(64)},
});

function fixture(){
 let currentOwner=owner,loads=0,queries=0,launches=0,finishes=0;
 const server={
  getAccountContext:async()=>{queries++;return context(currentOwner)},
  submitEvidence:async()=> 'verified' as const,
  readOwnerEntitlement:async()=>({entitled:true}),
 };
 const loadNativePort=async()=>{
  loads++;
  return {
   initConnection:async()=>true,
   fetchProducts:async()=>[{id:'allin365.monthly',
    subscriptionOffers:[{basePlanIdAndroid:'monthly',offerTokenAndroid:'store-offer'}]}],
   requestPurchase:async()=>{launches++},
   purchaseUpdatedListener:()=>({remove(){}}),
   purchaseErrorListener:()=>({remove(){}}),
   getAvailablePurchases:async()=>[{
    productId:'allin365.monthly',store:'google',purchaseToken:'play-token',
    purchaseState:'purchased',
   }],
   finishTransaction:async()=>{finishes++},
  };
 };
 return {
  server,loadNativePort,
  getAuthenticatedOwner:()=>currentOwner,
  setOwner:(id:string)=>{currentOwner=id},
  get:()=>({loads,queries,launches,finishes}),
 };
}

test('default release gate is entirely disabled and never imports native SDK',async()=>{
 const f=fixture();
 assert.equal(nativeBillingReleaseGate.enabled,false);
 assert.equal(nativeBillingReleaseGate.signedNativeBuild,false);
 assert.equal(await prepareNativeBillingRuntime({
  activation:nativeBillingReleaseGate,platform:'ios',...f,
 }),null);
 assert.deepEqual(f.get(),{loads:0,queries:0,launches:0,finishes:0});
});

test('every individual release gate denies native module import',async()=>{
 for(const key of Object.keys(approved) as (keyof typeof approved)[]){
  const f=fixture();
  const activation={...approved,[key]:false};
  assert.equal(await prepareNativeBillingRuntime({
   activation,platform:'android',...f,
  }),null,key);
  assert.equal(f.get().loads,0,key);
  assert.equal(f.get().queries,0,key);
 }
});

test('web and missing owner are denied before invoking server or native port',async()=>{
 const f=fixture();
 assert.equal(await prepareNativeBillingRuntime({
  activation:approved,platform:'web',...f,
 }),null);
 f.setOwner(null as unknown as string);
 assert.equal(await prepareNativeBillingRuntime({
  activation:approved,platform:'ios',...f,
 }),null);
 assert.equal(f.get().queries,0);
 assert.equal(f.get().loads,0);
});

test('server-mismatched owner context never opens native port',async()=>{
 const f=fixture();
 const runtime=await prepareNativeBillingRuntime({
  activation:approved,platform:'ios',...f,
  server:{...f.server,getAccountContext:async()=>context(other)},
 });
 assert.equal(runtime,null);
 assert.equal(f.get().loads,0);
});

test('approved Google native restoration still requires verified server entitlement',async()=>{
 const f=fixture();
 const flow=await prepareNativeBillingRuntime({
  activation:approved,platform:'android',...f,
 });
 assert.ok(flow);
 assert.equal(f.get().loads,1);
 assert.equal(f.get().launches,0);
 assert.equal(await flow!.restore(),'server_entitled');
 assert.equal(f.get().finishes,1);
 assert.equal(f.get().launches,0);
});

test('account switch while native port loads fails closed',async()=>{
 const f=fixture();
 const loader=async()=>{
  const port=await f.loadNativePort();
  f.setOwner(other);
  return port;
 };
 assert.equal(await prepareNativeBillingRuntime({
  activation:approved,platform:'ios',...f,loadNativePort:loader,
 }),null);
 assert.equal(f.get().launches,0);
});
