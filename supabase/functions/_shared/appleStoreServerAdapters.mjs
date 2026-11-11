/**
 * ALL-252: Apple App Store Server SDK-backed verification adapter.
 * Caller creates verifier with Apple's official SignedDataVerifier, trusted
 * DER root certificates + online revocation checks and sandbox environment,
 * and serverApi with signed App Store Server API credentials. Never accept a
 * decoded JWS from a client as proof.
 */
const uuid=v=>typeof v==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const numericId=v=>typeof v==='string'&&/^[0-9]{1,24}$/.test(v);
export function createAppleStoreServerAdapters({
 verifier,serverApi,expectedBundleId,expectedProductId,
 expectedEnvironment='Sandbox',clockMs,
}={}){
 if(!verifier||typeof verifier.verifyAndDecodeTransaction!=='function'||
    typeof verifier.verifyAndDecodeRenewalInfo!=='function'||
    !serverApi||typeof serverApi.getAllSubscriptionStatuses!=='function'||
    typeof clockMs!=='function'||typeof expectedBundleId!=='string'||
    typeof expectedProductId!=='string'||expectedEnvironment!=='Sandbox')
   return null;
 const checkTransaction=async jws=>{
   const result=await verifier.verifyAndDecodeTransaction(jws);
   if(result.bundleId!==expectedBundleId||
      result.environment!==expectedEnvironment||
      result.productId!==expectedProductId||
      result.type!=='Auto-Renewable Subscription'||
      !numericId(result.originalTransactionId)||
      !numericId(result.transactionId)||
      !uuid(result.appAccountToken))
     throw Error('apple_transaction_not_approved');
   return result;
 };
 return Object.freeze({
   async verifySignedJws(jws,context){
     if(context?.bundleId!==expectedBundleId||
        context?.environment!==expectedEnvironment)
       throw Error('apple_context_mismatch');
     return await checkTransaction(jws);
   },
   async verifyCurrentStatus({originalTransactionId,ownerId}={}){
     if(!numericId(originalTransactionId)||!uuid(ownerId))
       throw Error('apple_identity_invalid');
     let statuses;
     try{statuses=await serverApi.getAllSubscriptionStatuses(originalTransactionId)}
     catch{throw Error('apple_status_unavailable')}
     if(!Array.isArray(statuses?.data)||statuses.data.length<1)
       throw Error('apple_status_unavailable');
     const candidates=[];
     for(const group of statuses.data){
       if(!Array.isArray(group.lastTransactions))continue;
       for(const entry of group.lastTransactions){
         if(entry.originalTransactionId!==originalTransactionId||
            typeof entry.signedTransactionInfo!=='string'||
            typeof entry.signedRenewalInfo!=='string')continue;
         const transaction=await checkTransaction(entry.signedTransactionInfo);
         const renewal=await verifier.verifyAndDecodeRenewalInfo(entry.signedRenewalInfo);
         if(transaction.originalTransactionId!==originalTransactionId||
            transaction.appAccountToken.toLowerCase()!==ownerId.toLowerCase()||
            renewal.originalTransactionId!==originalTransactionId||
            renewal.environment!==expectedEnvironment||
            renewal.productId!==expectedProductId)
           throw Error('apple_current_owner_mismatch');
         const now=clockMs();
         if(!Number.isSafeInteger(now)||now<0)
           throw Error('apple_clock_unavailable');
         // Apple's status codes: 1 active, 2 expired, 3 billing retry,
         // 4 grace period, 5 revoked.
         const phaseByStatus={1:'paid',2:'expired',3:'billing_retry',
                              4:'grace',5:'revoked'};
         if(!Object.hasOwn(phaseByStatus,entry.status))
           throw Error('apple_current_status_unknown');
         let phase=phaseByStatus[entry.status];
         let until=null;
         if(['paid','grace'].includes(phase)){
           if(!Number.isSafeInteger(transaction.expiresDate))
             throw Error('apple_period_unverified');
           until=transaction.expiresDate;
           if(phase==='grace'){
             if(!Number.isSafeInteger(renewal.gracePeriodExpiresDate))
               throw Error('apple_grace_unverified');
             until=renewal.gracePeriodExpiresDate;
           }
           if(Number.isSafeInteger(transaction.revocationDate))
             throw Error('apple_revoked_current_transaction');
           if(until<=now){phase='expired';until=null;}
           else if(phase==='paid'&&renewal.autoRenewStatus===0)
             phase='canceling';
         }
         candidates.push({phase,accessUntil:until,originalTransactionId,
           ownerId,verificationSource:'apple_server_signed_current',
           latestTransactionId:transaction.transactionId});
       }
     }
     if(candidates.length!==1)
       throw Error('apple_current_subscription_ambiguous');
     return candidates[0];
   },
 });
}
