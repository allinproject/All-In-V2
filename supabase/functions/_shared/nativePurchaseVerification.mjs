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
 /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);

export async function verifyNativePurchaseForBinding({
 platform,authenticatedOwnerId,rawEvidence,
 appleConfig,verifyAppleSignedJws,verifyAppleCurrentStatus,
 googleConfig,fetchGoogleSubscription,googleAccountPepper,
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
   // Current status is an independently signed, verified store fact. Its
   // returned phase and expiry must be bounded by the transaction fact.
   const allowed=['trial','paid','grace','canceling'];
   if(!current||current.originalTransactionId!==proof.providerSubscriptionId||
      current.ownerId!==authenticatedOwnerId||
      ![...allowed,'expired','refunded','revoked'].includes(current.phase)||
      (allowed.includes(current.phase)&&
        (!Number.isSafeInteger(current.accessUntil)||
         proof.accessUntil===null||current.accessUntil>proof.accessUntil||
         current.accessUntil<=nowMs))||
      (!allowed.includes(current.phase)&&current.accessUntil!==null)||
      (['revoked','expired'].includes(proof.phase)&&
         allowed.includes(current.phase)))
     return {status:'verification_unavailable'};
   proof={...proof,phase:current.phase,accessUntil:current.accessUntil};
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
   const committed=await commitOwnerBoundPurchase({
     ownerId:authenticatedOwnerId,provider,
     providerSubscriptionId:subscriptionId,
     phase:proof.phase,accessUntil:proof.accessUntil,
     verificationSource:'provider_current',
   });
   if(committed!=='committed'&&committed!=='duplicate')
     return {status:'persistence_unavailable'};
   return {status:'provider_verified_and_persisted'};
 }catch{return {status:'persistence_unavailable'}}
}
