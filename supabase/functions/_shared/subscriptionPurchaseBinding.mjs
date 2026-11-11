/**
 * ALL-252 — server-only prebinding authorization for a verified checkout.
 *
 * Pure policy boundary. The caller MUST obtain checkoutAttempt from the
 * authenticated, server-owned checkout ledger, providerPurchase from the
 * provider's signed/secret-key API, and existingBinding under a DB transaction.
 * This is not an HTTP route, a purchase creator, or a receipt verifier.
 */
const safe = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 256 && value.trim() === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const providers = new Set(['app_store','google_play','stripe_web']);
const environments = new Set(['sandbox','production']);

export function authorizeVerifiedPurchaseBinding({
  authenticatedOwnerId,
  checkoutAttempt,
  providerPurchase,
  existingBinding = null,
} = {}) {
  if (!safe(authenticatedOwnerId) || !checkoutAttempt || !providerPurchase) {
    return { status: 'invalid' };
  }
  const a = checkoutAttempt;
  const p = providerPurchase;
  if (!providers.has(a.provider) || !environments.has(a.environment) ||
      !safe(a.ownerId) || !safe(a.attemptId) || !safe(a.providerSubscriptionId) ||
      !safe(a.providerCheckoutId) || !safe(p.providerSubscriptionId) ||
      !safe(p.providerCheckoutId) || p.provider !== a.provider ||
      p.environment !== a.environment ||
      p.providerSubscriptionId !== a.providerSubscriptionId ||
      p.providerCheckoutId !== a.providerCheckoutId ||
      a.state !== 'server_confirmed' || p.verification !== 'provider_confirmed') {
    return { status: 'unverified_purchase' };
  }
  if (a.ownerId !== authenticatedOwnerId) {
    return { status: 'wrong_owner' };
  }
  // No transfers or silent account claiming. Restores of purchases already
  // tied to other accounts must enter a separately reviewed support workflow.
  if (existingBinding !== null) {
    if (existingBinding.provider !== a.provider ||
        existingBinding.environment !== a.environment ||
        existingBinding.providerSubscriptionId !== a.providerSubscriptionId) {
      return { status: 'identity_collision' };
    }
    return existingBinding.ownerId === authenticatedOwnerId
      ? { status: 'already_bound' } : { status: 'owner_conflict' };
  }
  return { status: 'eligible_for_transaction', binding: {
    ownerId: authenticatedOwnerId,
    provider: a.provider,
    environment: a.environment,
    providerSubscriptionId: a.providerSubscriptionId,
    checkoutAttemptId: a.attemptId,
  } };
}
