/**
 * ALL-252 server-only Stripe checkout confirmation candidate.
 *
 * Retrieve Checkout Session and Subscription with a trusted, secret-key
 * adapter for ONE Stripe merchant/environment. The caller must first load
 * checkoutAttempt from a server-created, authenticated owner-bound pending
 * attempt. Do not expose the verifier, Stripe secret, or output as a client
 * API. Only a transactional backend may persist the resulting confirmation.
 */
const id = (value, prefix) => typeof value === 'string' &&
  value.startsWith(prefix) && value.length <= 256 &&
  /^[a-zA-Z0-9_]+$/.test(value);

const validUuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function confirmStripeCheckoutForBinding({
  expectedOwnerId,
  checkoutAttempt,
  retrieveCheckoutSession,
  retrieveSubscription,
  expectedLiveMode = false,
  approvedPriceId,
  approvedProductId,
} = {}) {
  if (typeof expectedOwnerId !== 'string' || !expectedOwnerId.trim() ||
      !checkoutAttempt || checkoutAttempt.ownerId !== expectedOwnerId ||
      checkoutAttempt.provider !== 'stripe_web' ||
      checkoutAttempt.environment !== (expectedLiveMode ? 'production' : 'sandbox') ||
      checkoutAttempt.state !== 'pending' ||
      !validUuid(checkoutAttempt.attemptId) ||
      !id(checkoutAttempt.providerCheckoutId, 'cs_') ||
      typeof retrieveCheckoutSession !== 'function' ||
      typeof retrieveSubscription !== 'function' ||
      !id(approvedPriceId, 'price_') || !id(approvedProductId, 'prod_')) {
    return {status:'invalid_attempt'};
  }

  let session;
  try {
    session = await retrieveCheckoutSession(checkoutAttempt.providerCheckoutId);
  } catch {
    return {status:'provider_unavailable'};
  }
  if (!session || session.object !== 'checkout.session' ||
      session.id !== checkoutAttempt.providerCheckoutId ||
      session.livemode !== expectedLiveMode ||
      session.mode !== 'subscription' || session.status !== 'complete' ||
      !['paid','no_payment_required'].includes(session.payment_status) ||
      !id(session.subscription,'sub_') || !id(session.customer,'cus_')) {
    return {status:'checkout_unconfirmed'};
  }

  let subscription;
  try {
    subscription = await retrieveSubscription(session.subscription);
  } catch {
    return {status:'provider_unavailable'};
  }
  if (!subscription || subscription.object !== 'subscription' ||
      subscription.id !== session.subscription ||
      subscription.livemode !== expectedLiveMode ||
      subscription.customer !== session.customer ||
      !['trialing','active'].includes(subscription.status) ||
      !Array.isArray(subscription.items?.data) ||
      subscription.items.data.length !== 1) {
    return {status:'subscription_unconfirmed'};
  }
  const item = subscription.items.data[0];
  const price = item?.price;
  if (!price || price.id !== approvedPriceId ||
      price.product !== approvedProductId ||
      price.currency !== 'usd' || price.unit_amount !== 999 ||
      price.type !== 'recurring' || price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1 || item.quantity !== 1) {
    return {status:'unapproved_offer'};
  }

  // The first trial must match the approved seven-day offer exactly.
  // An already eligible customer can instead enter an immediately active
  // paid plan, but must not receive an invented second trial.
  if (subscription.status === 'trialing' &&
      (!Number.isSafeInteger(subscription.trial_start) ||
       !Number.isSafeInteger(subscription.trial_end) ||
       subscription.trial_end - subscription.trial_start !== 7 * 24 * 60 * 60)) {
    return {status:'unapproved_trial'};
  }

  // Do not let a completed Checkout Session from another subscription replace
  // the ID already recorded in a server-owned pending attempt. The pending
  // attempt may omit that ID until its initial provider checkout completes.
  if (checkoutAttempt.providerSubscriptionId != null &&
      checkoutAttempt.providerSubscriptionId !== session.subscription) {
    return {status:'purchase_collision'};
  }
  return {
    status:'confirmed_for_binding_transaction',
    attempt: {
      ownerId:expectedOwnerId,
      attemptId:checkoutAttempt.attemptId,
      provider:'stripe_web',
      environment:checkoutAttempt.environment,
      providerCheckoutId:session.id,
      providerSubscriptionId:session.subscription,
      state:'server_confirmed',
    },
    providerPurchase: {
      provider:'stripe_web',
      environment:checkoutAttempt.environment,
      providerCheckoutId:session.id,
      providerSubscriptionId:session.subscription,
      verification:'provider_confirmed',
    },
  };
}
