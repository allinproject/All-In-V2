/**
 * ALL-252 — non-deployed server checkout request orchestrator.
 * A trusted HTTP worker must call this with its verified Authorization header
 * and server-injected auth, DB and Stripe functions. No client ownerId,
 * trial-eligible flag, redirect URL or checkout attempt ID is accepted.
 *
 * claimEligibleAttempt must serialize owner-level trial eligibility and
 * reserve/reuse exactly one durable UUID per active checkout. This module
 * cannot verify its own injected backend implementations and grants no access.
 */
import { prepareStripeSandboxCheckout } from './stripeCheckoutPreparation.mjs';

const uuid=value=>typeof value==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export async function handleStripeSandboxCheckoutRequest({
  method, authorization, rawBody,
  authenticateBearer, claimEligibleAttempt, claimPaidAttempt, reserveCheckoutAttempt,
  registerPendingCheckout, createCheckoutSession,
  priceId, merchantAccountId, successUrl, cancelUrl, approvedReturnOrigin,
}={}) {
  if(method!=='POST')return {status:405,code:'method_not_allowed'};
  if(rawBody!==undefined && rawBody!==null &&
      (!(rawBody instanceof Uint8Array) || rawBody.byteLength!==0))
    return {status:400,code:'body_not_allowed'};
  if(typeof authorization!=='string'||authorization.length>4096||
     !/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(authorization))
    return {status:401,code:'unauthorized'};
  if(typeof authenticateBearer!=='function'||
     typeof claimEligibleAttempt!=='function'||
     typeof reserveCheckoutAttempt!=='function'||
     typeof registerPendingCheckout!=='function'||
     typeof createCheckoutSession!=='function')
    return {status:503,code:'checkout_disabled'};

  let user;
  try { user=await authenticateBearer(authorization.slice(7)); }
  catch { return {status:401,code:'unauthorized'}; }
  if(!uuid(user?.id))return {status:401,code:'unauthorized'};

  let claim;
  try { claim=await claimEligibleAttempt({ownerId:user.id,provider:'stripe_web',
                                        environment:'sandbox'}); }
  catch {return {status:503,code:'eligibility_unavailable'};}
  // A former subscriber may pay again but must NOT receive a second trial.
  // The private paid claim must reject active or unreconciled subscriptions.
  const returningPaid = claim?.status==='trial_ineligible';
  if(returningPaid){
    if(typeof claimPaidAttempt!=='function')
      return {status:409,code:'trial_ineligible'};
    try{
      claim=await claimPaidAttempt({ownerId:user.id,provider:'stripe_web',
                                   environment:'sandbox'});
    }catch{return {status:503,code:'eligibility_unavailable'};}
  }
  if(claim?.status!=='eligible_reserved'||claim.ownerId!==user.id||
     !uuid(claim.attemptId)||claim.trialEligible!==!returningPaid)
    return {status:503,code:'checkout_unavailable'};

  const outcome=await prepareStripeSandboxCheckout({
    authenticatedOwnerId:user.id,
    expectedOwnerId:user.id, attemptId:claim.attemptId,
    trialEligible:claim.trialEligible, priceId,
    expectedMerchantAccountId:merchantAccountId,
    createCheckoutSession, reserveCheckoutAttempt, registerPendingCheckout,
    successUrl,cancelUrl,approvedReturnOrigin,
  });

  if(outcome.status==='pending_checkout_ready')
    return {status:200,code:'checkout_ready',checkoutUrl:outcome.checkoutUrl};
  if(outcome.status==='invalid_or_ineligible')
    return {status:503,code:'checkout_unavailable'};
  // No raw Stripe errors, account metadata or bearer tokens in responses.
  return {status:503,code:'checkout_temporarily_unavailable'};
}
