/**
 * ALL-252 Google Play subscription verification (source-only).
 * The purchase token comes from a device purchase, but this module does NOT
 * trust it as proof of payment. A service account with androidpublisher scope
 * must retrieve Google's current SubscriptionPurchaseV2 via its official API.
 * Never return/store raw purchase tokens in mobile entitlement responses.
 */
const appId=v=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(v)&&v.length<180;
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&
  /^[a-zA-Z0-9_.-]+$/.test(v);
const token=v=>typeof v==='string'&&v.length>=8&&v.length<=2048&&
  /^[a-zA-Z0-9._:-]+$/.test(v);
const expiry=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?
  Date.parse(v):null;
export async function verifyGooglePlaySubscription({
  packageName,purchaseToken,expectedPackageName,approvedProductId,approvedBasePlanId,
  fetchSubscription,nowMs,
}={}){
  if(!appId(expectedPackageName)||packageName!==expectedPackageName||
     !token(purchaseToken)||!id(approvedProductId)||!id(approvedBasePlanId)||
     typeof fetchSubscription!=='function'||!Number.isSafeInteger(nowMs)||nowMs<0)
    return {status:'invalid_request'};
  let result;
  try {
    // fetchSubscription MUST authenticate with a trusted Google service account
    // and use purchases.subscriptionsv2.get for expectedPackageName + token.
    result=await fetchSubscription({packageName,purchaseToken});
  }catch{return {status:'provider_unavailable'}}
  if(!result||result.kind!=='androidpublisher#subscriptionPurchaseV2'||
     !Array.isArray(result.lineItems)||result.lineItems.length!==1)
    return {status:'unverified_provider_state'};
  const line=result.lineItems[0];
  if(line?.productId!==approvedProductId||
     line.offerDetails?.basePlanId!==approvedBasePlanId||
     !line.autoRenewingPlan||line.prepaidPlan!=null)
    return {status:'unapproved_offer'};
  const end=expiry(line.expiryTime);
  if(end===null)return {status:'unverified_provider_state'};
  const state=result.subscriptionState;
  const entitledStates={
    SUBSCRIPTION_STATE_ACTIVE:'paid',
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD:'grace',
    SUBSCRIPTION_STATE_CANCELED:'canceling',
  };
  const terminalStates=new Set([
    'SUBSCRIPTION_STATE_EXPIRED','SUBSCRIPTION_STATE_ON_HOLD',
    'SUBSCRIPTION_STATE_PAUSED','SUBSCRIPTION_STATE_PENDING',
    'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
    'SUBSCRIPTION_STATE_UNSPECIFIED',
  ]);
  if(!Object.hasOwn(entitledStates,state)&&!terminalStates.has(state))
    return {status:'unverified_provider_state'};
  const active=Object.hasOwn(entitledStates,state)&&end>nowMs;
  if(active&&result.acknowledgementState!=='ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED')
    return {status:'acknowledgement_required'};
  // Google determines trial eligibility and offer IDs, not mobile price text.
  // If there is evidence of an active free trial, distinguish trial from paid.
  const trial=active&&state==='SUBSCRIPTION_STATE_ACTIVE'&&
    line.offerPhase?.freeTrial!=null;
  return {
    status:'verified_for_owner_binding',
    provider:'google_play',
    phase:active?(trial?'trial':entitledStates[state]):
      state==='SUBSCRIPTION_STATE_EXPIRED'?'expired':
      state==='SUBSCRIPTION_STATE_ON_HOLD'?'billing_retry':'revoked',
    accessUntil:active?end:null,
    providerProductId:approvedProductId,
    // Stable provider purchase identity must be derived server-side from
    // trusted transaction lineage; NOT blindly from an order ID or token.
    providerPurchaseIdentityPending:true,
  };
}
