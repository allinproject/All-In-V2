import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGooglePlaySubscription as verify} from './googlePlaySubscriptionVerification.mjs';
const now=1794410000000;
const packageName='com.allin365.app';
const item={productId:'allin365_monthly',expiryTime:new Date(now+86400000).toISOString(),
 autoRenewingPlan:{autoRenewEnabled:true},offerDetails:{basePlanId:'monthly'}};
const accountHash='a'.repeat(64);
const provider={kind:'androidpublisher#subscriptionPurchaseV2',
 subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',
 externalAccountIdentifiers:{obfuscatedExternalAccountId:accountHash},
 acknowledgementState:'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
 lineItems:[item]};
const base=()=>({packageName,expectedPackageName:packageName,
 purchaseToken:'tok_abc123456789',expectedObfuscatedAccountId:accountHash,
 approvedProductId:'allin365_monthly',
 approvedBasePlanId:'monthly',fetchSubscription:async()=>provider,nowMs:now});
const run=patch=>verify({...base(),...patch});
test('Google-current, acknowledged monthly state yields only owner-binding candidate',async()=>{
 const r=await run();
 assert.equal(r.status,'verified_for_owner_binding');
 assert.equal(r.phase,'paid');
 assert.equal(r.accessUntil,now+86400000);
 assert.equal(r.providerPurchaseIdentityPending,false);
 assert.match(r.providerSubscriptionId,/^sha256:[a-f0-9]{64}$/);
 assert.equal(r.providerSubscriptionId.includes('tok_'),false);
 assert.equal('purchaseToken' in r,false);
});
test('untrusted tokens and wrong app or missing API fail closed',async()=>{
 assert.equal((await run({packageName:'com.other.app'})).status,'invalid_request');
 assert.equal((await run({purchaseToken:'short'})).status,'invalid_request');
 assert.equal((await run({fetchSubscription:async()=>{throw Error('provider down')}})).status,
  'provider_unavailable');
});
test('wrong SKU, base plan, multiple items and prepaid plans rejected',async()=>{
 for(const lineItems of [
  [{...item,productId:'other'}],
  [{...item,offerDetails:{basePlanId:'annual'}}],
  [item,item],
  [{...item,prepaidPlan:{}}],
 ]){
  const r=await run({fetchSubscription:async()=>({...provider,lineItems})});
  assert.notEqual(r.status,'verified_for_owner_binding');
 }
});
test('unacknowledged purchases require provider acknowledgement before entitlement',async()=>{
 assert.equal((await run({fetchSubscription:async()=>({...provider,
  acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'})})).status,
  'acknowledgement_required');
});
test('on hold, paused, pending and expired must not grant access',async()=>{
 for(const state of ['SUBSCRIPTION_STATE_ON_HOLD','SUBSCRIPTION_STATE_PAUSED',
  'SUBSCRIPTION_STATE_PENDING','SUBSCRIPTION_STATE_EXPIRED']){
  const r=await run({fetchSubscription:async()=>({...provider,subscriptionState:state})});
  assert.equal(r.status,'verified_for_owner_binding');
  assert.equal(r.accessUntil,null);
 }
});
test('grace and canceled access are bounded by provider expiry',async()=>{
 const grace=await run({fetchSubscription:async()=>({...provider,
  subscriptionState:'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'})});
 assert.equal(grace.phase,'grace');
 const cancelled=await run({fetchSubscription:async()=>({...provider,
  subscriptionState:'SUBSCRIPTION_STATE_CANCELED'})});
 assert.equal(cancelled.phase,'canceling');
 const expired=await run({fetchSubscription:async()=>({...provider,
  lineItems:[{...item,expiryTime:new Date(now-1).toISOString()}]})});
 assert.equal(expired.accessUntil,null);
});

test('Google Play account binding must match server-owned obfuscation',async()=>{
 const wrong=await run({expectedObfuscatedAccountId:'b'.repeat(64)});
 assert.equal(wrong.status,'owner_binding_unverified');
 const missing=await run({fetchSubscription:async()=>({...provider,
  externalAccountIdentifiers:null})});
 assert.equal(missing.status,'owner_binding_unverified');
});

test('linked Google purchase token cannot silently replace original bound owner',async()=>{
 const r=await run({fetchSubscription:async()=>({...provider,
  linkedPurchaseToken:'old-token-123456'})});
 assert.equal(r.status,'linked_purchase_reconciliation_required');
});
