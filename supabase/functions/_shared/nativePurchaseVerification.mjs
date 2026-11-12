/**
 * ALL-252 native store purchase/restore acceptance boundary.
 * The service MUST authenticate its caller independently before invoking this.
 * This function cannot authenticate an Apple signing certificate or Google
 * OAuth token itself; those provider adapters MUST be trusted server-side.
 * No client-supplied "verified", owner metadata or local store callback
 * can grant app access.
 */
import {verifyAppleStoreTransaction} from './appleStoreTransactionVerification.mjs';
import {verifyGooglePlaySubscription} from './googlePlaySubscriptionVerification.mjs';
import {obfuscatedGoogleBillingAccountId} from './googleBillingAccountBinding.mjs';
const uuid=v=>typeof v==='string'&&
 /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);

export async function verifyNativePurchaseForBinding({
 platform,authenticatedOwnerId,rawEvidence,
 appleConfig,verifyAppleSignedJws,verifyAppleCurrentStatus,
 googleConfig,fetchGoogleSubscription,acknowledgeGoogleSubscription,
 googleAccountPepper,
 findBoundOwner,commitOwnerBoundPurchase,nowMs,
}={}){
 if(!uuid(authenticatedOwnerId)||!rawEvidence||
    typeof rawEvidence!=='object'||!Number.isSafeInteger(nowMs)||nowMs<0||
    typeof findBoundOwner!=='function'||
    typeof commitOwnerBoundPurchase!=='function')
   return {status:'invalid_request'};
 let proof;
 if(platform==='ios'){
   if(typeof verifyAppleSignedJws!=='function'||
      typeof verifyAppleCurrentStatus!=='function')
     return {status:'verification_unavailable'};
   proof=await verifyAppleStoreTransaction({
    signedTransaction:rawEvidence.signedTransaction,
    expectedBundleId:appleConfig?.bundleId,
    expectedProductId:appleConfig?.productId,
    expectedEnvironment:appleConfig?.environment,
    expectedAccountToken:authenticatedOwnerId,
    verifySignedJws:verifyAppleSignedJws,nowMs,
   });
   if(proof.status!=='verified_for_owner_binding')
     return {status:'verification_unavailable'};
   let current;
   try{current=await verifyAppleCurrentStatus({
     originalTransactionId:proof.providerSubscriptionId,
     ownerId:authenticatedOwnerId,
   })}catch{return {status:'verification_unavailable'}}
   // Apple's signed CURRENT subscription status can legitimately extend
   // beyond the signed transaction supplied by the client (renewals, grace).
   // It must be verified afresh by the server SDK, never trusted from the
   // client transaction or unsigned JSON.
   const allowed=['trial','paid','grace','canceling'];
   if(!current||current.verificationSource!=='apple_server_signed_current'||
      current.originalTransactionId!==proof.providerSubscriptionId||
      current.ownerId!==authenticatedOwnerId||
      ![...allowed,'expired','refunded','revoked','billing_retry'].includes(current.phase)||
      (allowed.includes(current.phase)&&
        (!Number.isSafeInteger(current.accessUntil)||
         current.accessUntil<=nowMs))||
      (!allowed.includes(current.phase)&&current.accessUntil!==null))
     return {status:'verification_unavailable'};
   proof={...proof,phase:current.phase,accessUntil:current.accessUntil,
     latestTransactionId:current.latestTransactionId};
 }else if(platform==='android'){
   if(typeof fetchGoogleSubscription!=='function')
     return {status:'verification_unavailable'};
   const hashed=await obfuscatedGoogleBillingAccountId({
     ownerId:authenticatedOwnerId,environment:googleConfig?.environment,
     serverPepper:googleAccountPepper,
   });
   if(!hashed)return {status:'verification_unavailable'};
   proof=await verifyGooglePlaySubscription({
     packageName:googleConfig?.packageName,
     expectedPackageName:googleConfig?.packageName,
     purchaseToken:rawEvidence.purchaseToken,
     approvedProductId:googleConfig?.productId,
     approvedBasePlanId:googleConfig?.basePlanId,
     expectedObfuscatedAccountId:hashed,
     fetchSubscription:fetchGoogleSubscription,nowMs,
   });
   if(proof.status==='acknowledgement_required' &&
      typeof acknowledgeGoogleSubscription==='function'){
     // The provider's current record has already matched account, SKU and
     // base plan. Acknowledge using the trusted service API, then re-fetch
     // current state; a failed acknowledgement cannot grant access.
     try {
       await acknowledgeGoogleSubscription({
         packageName:googleConfig?.packageName,
         purchaseToken:rawEvidence.purchaseToken,
       });
       proof=await verifyGooglePlaySubscription({
         packageName:googleConfig?.packageName,
         expectedPackageName:googleConfig?.packageName,
         purchaseToken:rawEvidence.purchaseToken,
         approvedProductId:googleConfig?.productId,
         approvedBasePlanId:googleConfig?.basePlanId,
         expectedObfuscatedAccountId:hashed,
         fetchSubscription:fetchGoogleSubscription,nowMs,
       });
     } catch {return {status:'acknowledgement_required'};}
   }
   if(proof.status!=='verified_for_owner_binding')
     return {status:proof.status==='acknowledgement_required'?
       'acknowledgement_required':'verification_unavailable'};
 }else return {status:'invalid_request'};

 const provider=platform==='ios'?'app_store':'google_play';
 const subscriptionId=proof.providerSubscriptionId;
 if(typeof subscriptionId!=='string'||!subscriptionId)
   return {status:'verification_unavailable'};
 let existing;
 try { existing=await findBoundOwner({provider,
   providerSubscriptionId:subscriptionId}); }
 catch{return {status:'persistence_unavailable'}}
 if(existing!=null&&existing!==authenticatedOwnerId)
   return {status:'purchase_owned_by_another_account'};
 try {
   // Deterministic provider-event identity makes retries idempotent without
   // storing Google tokens or accepting client-assigned revisions.
   let eventMaterial;
   if(platform==='ios'){
     const currentId=proof.latestTransactionId??proof.providerTransactionId;
     if(typeof currentId!=='string'||!/^[0-9]{1,24}$/.test(currentId))
       return {status:'verification_unavailable'};
     eventMaterial='apple:'+currentId+':'+proof.phase+':'+proof.accessUntil;
   }else{
     eventMaterial='google:'+subscriptionId+':'+proof.phase+':'+proof.accessUntil;
   }
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',
     new TextEncoder().encode(eventMaterial)));
   const providerEventId='native_'+Array.from(digest,
     b=>b.toString(16).padStart(2,'0')).join('');
   const committed=await commitOwnerBoundPurchase({
     ownerId:authenticatedOwnerId,provider,
     providerSubscriptionId:subscriptionId,providerEventId,
     phase:proof.phase,accessUntil:proof.accessUntil,
     verificationSource:'provider_current',
   });
   if(committed!=='committed'&&committed!=='duplicate')
     return {status:'persistence_unavailable'};
   return {status:'provider_verified_and_persisted'};
 }catch{return {status:'persistence_unavailable'}}
}
