import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyNativePurchaseForBinding as verify} from './nativePurchaseVerification.mjs';
import {obfuscatedGoogleBillingAccountId} from './googleBillingAccountBinding.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='00000000-0000-0000-0000-000000000001';
const now=1794410000000;
const apple={
 bundleId:'com.allin365.app',environment:'Sandbox',productId:'allin365.monthly',
 type:'Auto-Renewable Subscription',originalTransactionId:'1234567890',
 transactionId:'1234567891',appAccountToken:owner,
 purchaseDate:now-1000,expiresDate:now+86400000,
};
const appleArgs=()=>({
 platform:'ios',authenticatedOwnerId:owner,rawEvidence:{
  signedTransaction:'eyJhbGciOiJFUzI1NiJ9.eyJpZCI6MX0.dGVzdA'},
 appleConfig:{bundleId:'com.allin365.app',productId:'allin365.monthly',
  environment:'Sandbox'},
 verifyAppleSignedJws:async()=>apple,
 verifyAppleCurrentStatus:async()=>({
  ownerId:owner,originalTransactionId:'1234567890',
  phase:'paid',accessUntil:now+86400000,
 }),
 findBoundOwner:async()=>null,
 commitOwnerBoundPurchase:async()=> 'committed',nowMs:now,
});
test('Apple signed and current-status verified, then owner-bound commit',async()=>{
 const result=await verify(appleArgs());
 assert.equal(result.status,'provider_verified_and_persisted');
});
test('Apple cannot extend access beyond verified JWS or transfer ownership',async()=>{
 let writes=0;
 const base=appleArgs();
 for(const opts of [
  {verifyAppleSignedJws:async()=>({...apple,appAccountToken:'00000000-0000-0000-0000-000000000002'})},
  {verifyAppleCurrentStatus:async()=>({ownerId:owner,
    originalTransactionId:'1234567890',phase:'paid',accessUntil:now+86400000*2})},
  {findBoundOwner:async()=> '00000000-0000-0000-0000-000000000002'},
 ]){
  const r=await verify({...base,...opts,
   commitOwnerBoundPurchase:async()=>{writes++;return 'committed'}});
  assert.notEqual(r.status,'provider_verified_and_persisted');
 }
 assert.equal(writes,0);
});
test('Android verified obfuscated owner, API proof and commit',async()=>{
 const pepper='this-is-a-long-server-secret-pepper-123456789';
 const hashed=await obfuscatedGoogleBillingAccountId({
  ownerId:owner,environment:'sandbox',serverPepper:pepper,
 });
 const r=await verify({
  platform:'android',authenticatedOwnerId:owner,rawEvidence:{
   purchaseToken:'token_google_123456789'},
  googleConfig:{packageName:'com.allin365.app',productId:'monthly_v2',
   basePlanId:'monthly',environment:'sandbox'},
  googleAccountPepper:pepper,
  fetchGoogleSubscription:async()=>({
   kind:'androidpublisher#subscriptionPurchaseV2',
   externalAccountIdentifiers:{obfuscatedExternalAccountId:hashed},
   acknowledgementState:'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
   subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',
   lineItems:[{productId:'monthly_v2',offerDetails:{basePlanId:'monthly'},
    autoRenewingPlan:{autoRenewEnabled:true},
    expiryTime:new Date(now+86400000).toISOString()}],
  }),
  findBoundOwner:async()=>null,commitOwnerBoundPurchase:async()=> 'committed',nowMs:now,
 });
 assert.equal(r.status,'provider_verified_and_persisted');
});
test('database outage is not a successful native purchase',async()=>{
 for(const opts of [
  {commitOwnerBoundPurchase:async()=>{throw Error('offline')}},
  {commitOwnerBoundPurchase:async()=> 'not_committed'},
 ]){
  assert.equal((await verify({...appleArgs(),...opts})).status,'persistence_unavailable');
 }
});
