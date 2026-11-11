/**
 * ALL-252 Apple App Store subscription evidence gate (source-only).
 * Incoming transaction is a signed compact JWS. The trusted verifySignedJws
 * dependency MUST perform full Apple x5c chain + signature + environment
 * verification (prefer Apple's App Store Server Library), including expiry and
 * revocation checks. DO NOT decode raw JWS yourself and call it verified.
 * Nothing here creates a purchase or grants client entitlement.
 */
const uuid=v=>typeof v==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const positiveId=v=>typeof v==='string'&&/^[0-9]{1,24}$/.test(v);
const appId=v=>typeof v==='string'&&
  /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(v);
export async function verifyAppleStoreTransaction({
  signedTransaction,expectedBundleId,expectedProductId,expectedEnvironment,
  expectedAccountToken,verifySignedJws,nowMs,
}={}){
  if(typeof signedTransaction!=='string'||signedTransaction.length>32768||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signedTransaction)||
     !appId(expectedBundleId)||!expectedProductId||
     !['Sandbox','Production'].includes(expectedEnvironment)||
     !uuid(expectedAccountToken)||typeof verifySignedJws!=='function'||
     !Number.isSafeInteger(nowMs)||nowMs<0)
    return {status:'invalid_request'};
  let transaction;
  try {
    transaction=await verifySignedJws(signedTransaction,{
      bundleId:expectedBundleId,environment:expectedEnvironment,
    });
  }catch{return {status:'signature_invalid'}}
  if(!transaction||transaction.bundleId!==expectedBundleId||
     transaction.environment!==expectedEnvironment||
     transaction.productId!==expectedProductId||
     transaction.type!=='Auto-Renewable Subscription'||
     !positiveId(transaction.originalTransactionId)||
     !positiveId(transaction.transactionId)||
     transaction.appAccountToken?.toLowerCase()!==expectedAccountToken.toLowerCase()||
     !Number.isSafeInteger(transaction.expiresDate)||
     !Number.isSafeInteger(transaction.purchaseDate))
    return {status:'unverified_provider_state'};
  const revoked=Number.isSafeInteger(transaction.revocationDate);
  const active=!revoked&&transaction.expiresDate>nowMs;
  return {
    status:'verified_for_owner_binding',
    provider:'app_store',
    providerSubscriptionId:transaction.originalTransactionId,
    providerTransactionId:transaction.transactionId,
    phase:revoked?'revoked':active?'paid':'expired',
    accessUntil:active?transaction.expiresDate:null,
    accountTokenMatch:true,
    // The App Store Server API current subscription status + signed renewal
    // data must also be checked before determining grace, trial, or canceling.
    currentStatusCheckRequired:true,
  };
}
