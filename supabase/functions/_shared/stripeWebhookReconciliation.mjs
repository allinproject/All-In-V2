/**
 * ALL-252: staged Stripe webhook reconciliation boundary.
 * A signed webhook is a NOTIFICATION, not current billing state or proof of
 * V2 account ownership. Never persist or ack before a trusted backend verifies
 * the current subscription on the configured sandbox merchant AND commits
 * the state in the private, owner-bound, transactional ledger.
 *
 * commitAuthoritativeReconciliation must locate the ORIGINAL immutable
 * owner-bound purchase, order provider revisions, apply its event transaction
 * and durably record event processing before returning 'committed'/'duplicate'.
 * This module does not implement or bypass that protected database writer.
 */
import {verifyStripeSandboxWebhook} from './stripeWebhookVerification.mjs';
import {projectStripeSandboxSubscription} from './stripeSubscriptionProjection.mjs';
const id=(x,p)=>typeof x==='string'&&x.startsWith(p)&&x.length<=256&&
  /^[a-zA-Z0-9_]+$/.test(x);
export async function reconcileStripeSandboxWebhook({
  rawBody,signatureHeader,webhookSecrets,nowSeconds,
  retrieveSubscription,retrieveCheckoutSession,
  commitAuthoritativeReconciliation,approvedPriceId,approvedProductId,
}={}){
  const signature=await verifyStripeSandboxWebhook({
    rawBody,signatureHeader,webhookSecrets,nowSeconds,
  });
  if(signature.status==='invalid_signature'||signature.status==='invalid_envelope'||
     signature.status==='invalid_event')return {status:400,code:'invalid_notification'};
  if(signature.status==='ignored_event')return {status:200,code:'ignored'};
  if(signature.status!=='verified_notification')
    return {status:503,code:'reconciliation_unavailable'};
  if(typeof retrieveSubscription!=='function'||
     typeof retrieveCheckoutSession!=='function'||
     typeof commitAuthoritativeReconciliation!=='function')
    return {status:503,code:'reconciliation_unavailable'};

  // Handle only notifications whose subscription ID can be independently
  // resolved. Other signed notifications must remain unacknowledged until the
  // processing contract is implemented (rather than silently dropping them).
  let subscriptionId=null;
  if(signature.eventType.startsWith('customer.subscription.')){
    subscriptionId=signature.objectId;
  }else if(signature.eventType.startsWith('checkout.session.')){
    try{
      const checkout=await retrieveCheckoutSession(signature.objectId);
      if(checkout?.id!==signature.objectId||checkout.livemode!==false||
         checkout.object!=='checkout.session'||!id(checkout.subscription,'sub_'))
        return {status:503,code:'provider_unavailable'};
      subscriptionId=checkout.subscription;
    }catch{return {status:503,code:'provider_unavailable'}}
  }else return {status:503,code:'unsupported_event'};

  let current;
  try{current=await retrieveSubscription(subscriptionId)}
  catch{return {status:503,code:'provider_unavailable'}}
  if(!current||current.object!=='subscription'||current.id!==subscriptionId||
     current.livemode!==false||!id(current.customer,'cus_')||
     typeof current.status!=='string')
    return {status:503,code:'provider_unavailable'};

  const projection=projectStripeSandboxSubscription({
    subscription:current,approvedPriceId,approvedProductId,nowSeconds,
  });
  if(projection.status!=='verified_state')
    return {status:503,code:'unverified_provider_state'};

  let result;
  try {
    result=await commitAuthoritativeReconciliation({
      provider:'stripe_web',environment:'sandbox',
      providerEventId:signature.eventId,
      eventType:signature.eventType,
      providerSubscriptionId:subscriptionId,
      currentProviderSubscription:current,
      verifiedProjection:projection,
    });
  }catch{return {status:503,code:'persistence_unavailable'}}
  if(result==='committed'||result==='duplicate')
    return {status:200,code:'accepted'};
  // Do not turn an unbound purchase, schema outage or lock contention into
  // a successful Stripe delivery; Stripe should retry.
  return {status:503,code:'persistence_unavailable'};
}
