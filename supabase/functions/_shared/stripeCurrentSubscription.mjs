/**
 * ALL-252: Validate a current Stripe subscription retrieved using a trusted
 * server-side secret-key adapter, NOT webhook event.data or client metadata.
 *
 * This is a source-only sandbox integration gate, not a deployed endpoint.
 * A future worker must authenticate the original Stripe webhook first,
 * retrieve subscription state from the correct merchant/environment,
 * resolve immutable purchase ownership, serialize and persist the revision,
 * and only then apply the verified purchase ledger transaction.
 */
const validId = (value, prefix) =>
  typeof value === 'string' && value.startsWith(prefix) &&
  /^[a-zA-Z0-9_]+$/.test(value) && value.length <= 256;

const safeTime = seconds =>
  Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 8640000000000 / 1000
    ? seconds * 1000 : null;

/**
 * @param {object} input
 * @param {(subscriptionId:string)=>Promise<object>} input.retrieveSubscription
 *   Trusted Stripe SDK client using the server key for the selected environment.
 * @param {(purchase:object)=>Promise<string|null>} input.resolveOwner
 *   Immutable, separately trusted mapping; do not derive from Stripe metadata.
 * @param {object} input.authenticatedEnvelope
 *   Output from authenticateStripeWebhookEnvelope, not arbitrary JSON.
 * @param {string} input.subscriptionId From trusted event object validation.
 * @param {number} input.serverRevision Strictly increasing writer-side revision
 *   minted under transaction lock after querying current provider state.
 */
export async function reconcileStripeCurrentState({
  authenticatedEnvelope, subscriptionId, retrieveSubscription, resolveOwner,
  serverRevision, expectedLiveMode = false, approvedPriceId, approvedProductId,
} = {}) {
  if (!authenticatedEnvelope || authenticatedEnvelope.status !== 'authenticated_envelope' ||
      !validId(authenticatedEnvelope.eventId, 'evt_') ||
      authenticatedEnvelope.liveMode !== expectedLiveMode ||
      !validId(subscriptionId, 'sub_') ||
      typeof retrieveSubscription !== 'function' || typeof resolveOwner !== 'function' ||
      !Number.isSafeInteger(serverRevision) || serverRevision < 1 ||
      !validId(approvedPriceId, 'price_') || !validId(approvedProductId, 'prod_')) {
    return { status: 'invalid_request' };
  }
  let subscription;
  try {
    subscription = await retrieveSubscription(subscriptionId);
  } catch {
    return { status: 'provider_unavailable' };
  }
  if (!subscription || subscription.object !== 'subscription' ||
      subscription.id !== subscriptionId ||
      subscription.livemode !== expectedLiveMode ||
      !validId(subscription.customer, 'cus_') ||
      !Array.isArray(subscription.items?.data) ||
      subscription.items.data.length !== 1) {
    return { status: 'provider_mismatch' };
  }
  const item = subscription.items.data[0];
  const price = item?.price;
  if (!price || price.id !== approvedPriceId ||
      price.product !== approvedProductId ||
      price.currency !== 'usd' || price.unit_amount !== 999 ||
      price.type !== 'recurring' || price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1 || item.quantity !== 1) {
    return { status: 'unapproved_offer' };
  }

  // No invented grace period. Stripe retry/past_due/unpaid is NOT paid access.
  const status = subscription.status;
  let phase;
  let accessUntil = null;
  if (status === 'trialing') {
    phase = 'trial';
    accessUntil = safeTime(subscription.trial_end);
  } else if (status === 'active') {
    phase = subscription.cancel_at_period_end ? 'canceling' : 'paid';
    // Account for both classic subscription field and newer per-item period.
    const period = subscription.current_period_end ?? item.current_period_end;
    accessUntil = safeTime(period);
  } else if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') {
    phase = 'billing_retry';
  } else if (status === 'canceled' || status === 'incomplete_expired' || status === 'paused') {
    phase = 'expired';
  } else {
    return { status: 'unknown_provider_status' };
  }
  if ((phase === 'trial' || phase === 'paid' || phase === 'canceling') &&
      accessUntil === null) return { status: 'missing_period' };

  let ownerId;
  try {
    ownerId = await resolveOwner({
      provider: 'stripe_web', subscriptionId, customerId: subscription.customer,
      environment: expectedLiveMode ? 'production' : 'sandbox',
    });
  } catch {
    return { status: 'owner_unresolved' };
  }
  if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.trim() !== ownerId) {
    return { status: 'owner_unresolved' };
  }
  return { status: 'verified_for_transaction', fact: {
    ownerId, provider: 'stripe_web', providerSubscriptionId: subscriptionId,
    providerEventId: authenticatedEnvelope.eventId, revision: serverRevision,
    phase, accessUntil,
  } };
}
