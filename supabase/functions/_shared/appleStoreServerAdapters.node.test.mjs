import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppleStoreServerAdapters} from './appleStoreServerAdapters.mjs';
const owner='00000000-0000-0000-0000-000000000001';
const now=1794410000000;
const transaction={bundleId:'com.allin365.app',environment:'Sandbox',
 productId:'allin365.monthly',type:'Auto-Renewable Subscription',
 transactionId:'1234567002',originalTransactionId:'1234567001',
 appAccountToken:owner,expiresDate:now+86400000,purchaseDate:now-1000};
const renewal={originalTransactionId:'1234567001',environment:'Sandbox',
 productId:'allin365.monthly',autoRenewStatus:1};
const group=(status,tx=transaction,ren=renewal)=>({
 lastTransactions:[{status,originalTransactionId:'1234567001',
  signedTransactionInfo:'signed-current-jws',
  signedRenewalInfo:'signed-renewal-jws'}],
});
function setup({tx=transaction,ren=renewal,status=1}={}){
 let signatures=0;
 const verifier={
  verifyAndDecodeTransaction:async()=>{signatures++;return tx;},
  verifyAndDecodeRenewalInfo:async()=>{signatures++;return ren;},
 };
 const api={getAllSubscriptionStatuses:async()=>({data:[group(status,tx,ren)]})};
 const adapter=createAppleStoreServerAdapters({verifier,serverApi:api,
  expectedBundleId:'com.allin365.app',expectedProductId:'allin365.monthly',
  expectedEnvironment:'Sandbox',clockMs:()=>now});
 return {adapter,getSignatures:()=>signatures};
}
test('trusted Apple SDK transaction and signed renewal establish current active period',async()=>{
 const {adapter,getSignatures}=setup();
 const proof=await adapter.verifySignedJws('client-jws',{
  bundleId:'com.allin365.app',environment:'Sandbox'});
 assert.equal(proof.transactionId,'1234567002');
 const current=await adapter.verifyCurrentStatus({
  originalTransactionId:'1234567001',ownerId:owner});
 assert.equal(current.verificationSource,'apple_server_signed_current');
 assert.equal(current.phase,'paid');
 assert.equal(current.accessUntil,now+86400000);
 assert.equal(getSignatures(),3);
});
test('Apple cancellation keeps bounded access while auto-renew is disabled',async()=>{
 const current=await setup({ren:{...renewal,autoRenewStatus:0}})
  .adapter.verifyCurrentStatus({originalTransactionId:'1234567001',ownerId:owner});
 assert.equal(current.phase,'canceling');
});
test('Apple signed grace uses signed gracePeriodExpiresDate after old period',async()=>{
 const end=now+2*86400000;
 const current=await setup({status:4,ren:{...renewal,
   gracePeriodExpiresDate:end}}).adapter.verifyCurrentStatus({
   originalTransactionId:'1234567001',ownerId:owner});
 assert.equal(current.phase,'grace');
 assert.equal(current.accessUntil,end);
});
test('expired revoked and billing-retry statuses have no access',async()=>{
 for(const [status,phase] of [[2,'expired'],[3,'billing_retry'],[5,'revoked']]){
   const current=await setup({status}).adapter.verifyCurrentStatus({
     originalTransactionId:'1234567001',ownerId:owner});
   assert.equal(current.phase,phase);
   assert.equal(current.accessUntil,null);
 }
});
test('Apple verified owner uses five-group UUID, never four-group alias',async()=>{
 await assert.rejects(()=>setup().adapter.verifyCurrentStatus({
  originalTransactionId:'1234567001',
  ownerId:'00000000-0000-0000-000000000001',
 }),/apple_identity_invalid/);
 const valid=await setup().adapter.verifyCurrentStatus({
  originalTransactionId:'1234567001',ownerId:owner,
 });
 assert.equal(valid.ownerId,owner);
});
test('wrong owner, product, missing verifier and unknown signed status fail closed',async()=>{
 assert.equal(createAppleStoreServerAdapters({}),null);
 for(const options of [
  {tx:{...transaction,appAccountToken:'00000000-0000-0000-0000-000000000002'}},
  {tx:{...transaction,productId:'allin365.annual'}},
  {ren:{...renewal,originalTransactionId:'invalid'}},
  {status:9},
 ]){
   await assert.rejects(()=>setup(options).adapter.verifyCurrentStatus({
     originalTransactionId:'1234567001',ownerId:owner}));
 }
});
test('ambiguous or missing App Store API status is not accepted',async()=>{
 const verifier={verifyAndDecodeTransaction:async()=>transaction,
  verifyAndDecodeRenewalInfo:async()=>renewal};
 for(const data of [[],[group(1),group(1)],[{lastTransactions:[]}]]){
   const a=createAppleStoreServerAdapters({verifier,
     serverApi:{getAllSubscriptionStatuses:async()=>({data})},
     expectedBundleId:'com.allin365.app',expectedProductId:'allin365.monthly',
     expectedEnvironment:'Sandbox',clockMs:()=>now});
   await assert.rejects(()=>a.verifyCurrentStatus({
     originalTransactionId:'1234567001',ownerId:owner}));
 }
});
