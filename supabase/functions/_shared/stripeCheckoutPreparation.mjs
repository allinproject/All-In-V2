/**
 * ALL-252: server-only Stripe Checkout preparation boundary, NOT a deployed
 * route or Stripe SDK. Inputs must come from authenticated server context and
 * trusted configuration; callbacks must use a merchant-scoped Stripe secret.
 * The sole authority to grant access remains the verified subscription ledger.
 */
const uuid = v => typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const stripeId = (v,prefix) => typeof v === 'string' && v.startsWith(prefix) &&
  /^[a-zA-Z0-9_]+$/.test(v) && v.length <= 256;

export async function prepareStripeSandboxCheckout({
  authenticatedOwnerId, expectedOwnerId, attemptId, trialEligible,
  priceId, expectedMerchantAccountId, createCheckoutSession,
  registerPendingCheckout, successUrl, cancelUrl, approvedReturnOrigin,
} = {}) {
  if (!uuid(authenticatedOwnerId) || expectedOwnerId !== authenticatedOwnerId ||
      !uuid(attemptId) || trialEligible !== true ||
      !stripeId(priceId,'price_') || !stripeId(expectedMerchantAccountId,'acct_') ||
      typeof createCheckoutSession !== 'function' ||
      typeof registerPendingCheckout !== 'function') {
    return {status:'invalid_or_ineligible'};
  }

  // Return URLs must be trusted server-configured HTTPS URLs, not redirect
  // destinations supplied by a customer. Exact origin match is mandatory.
  try {
    const origin = new URL(approvedReturnOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== approvedReturnOrigin ||
        [successUrl,cancelUrl].some(v => {
          const u = new URL(v);
          return u.protocol !== 'https:' || u.origin !== origin.origin ||
                 !!u.username || !!u.password;
        })) return {status:'invalid_return_url'};
  } catch {
    return {status:'invalid_return_url'};
  }

  // The configured Stripe SDK adapter MUST use a secret key scoped to the
  // expected SANDBOX merchant and preserve this idempotency key on retries.
  const idempotencyKey = 'allin-v2-checkout-' + attemptId;
  let session;
  try {
    session = await createCheckoutSession({
      idempotencyKey,
      merchantAccountId: expectedMerchantAccountId,
      mode:'subscription',
      line_items:[{price:priceId,quantity:1}],
      subscription_data:{trial_period_days:7},
      client_reference_id:attemptId,
      success_url:successUrl,
      cancel_url:cancelUrl,
    });
  } catch {
    return {status:'provider_unavailable'};
  }
  if (!session || !stripeId(session.id,'cs_') ||
      session.livemode !== false || session.mode !== 'subscription' ||
      session.status !== 'open' ||
      session.merchantAccountId !== expectedMerchantAccountId ||
      session.client_reference_id !== attemptId ||
      typeof session.url !== 'string' ||
      !session.url.startsWith('https://checkout.stripe.com/')) {
    return {status:'provider_mismatch'};
  }

  // Only after the service-only ledger acknowledges the immutable pending
  // account/session binding may the app receive a checkout URL.
  let result;
  try {
    result = await registerPendingCheckout({
      attemptId, ownerId:expectedOwnerId,
      authenticatedOwnerId, provider:'stripe_web',
      environment:'sandbox', providerCheckoutId:session.id,
    });
  } catch {
    return {status:'persistence_unavailable'};
  }
  if (result !== 'pending' && result !== 'already_pending') {
    return {status:'persistence_rejected'};
  }
  return {status:'pending_checkout_ready', checkoutUrl:session.url};
}
