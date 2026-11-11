/**
 * ALL-252. Service-only ingress boundary for subscription provider notifications.
 *
 * Deliberately does not implement Apple/Google/Stripe cryptographic verification.
 * Each provider adapter must validate the original signed request, including
 * environment, freshness and provider account, before returning a receipt.
 * A client-supplied "verified" flag is never evidence of payment.
 *
 * No network or persistence here: production must atomically commit provider
 * events and entitlement updates under the owning subscription transaction.
 */
const providers = new Set(['app_store', 'google_play', 'stripe_web']);
const states = new Set(['trial', 'paid', 'grace', 'billing_retry', 'canceling', 'expired', 'refunded', 'revoked']);

const safeId = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 256 && value.trim() === value &&
  !/[\x00-\x1f\x7f]/.test(value);

function validAuthenticatedState(state) {
  return !!state && typeof state === 'object' &&
    safeId(state.providerSubscriptionId) && safeId(state.providerEventId) &&
    states.has(state.phase) && Number.isSafeInteger(state.revision) &&
    state.revision >= 0 &&
    (state.accessUntil === null || (Number.isSafeInteger(state.accessUntil) &&
      state.accessUntil >= 0)) &&
    (!['trial', 'paid', 'grace', 'canceling'].includes(state.phase) ||
      state.accessUntil !== null);
}

/**
 * @param {object} options
 * @param {'app_store'|'google_play'|'stripe_web'} options.provider
 * @param {Uint8Array} options.rawBody Untouched request bytes
 * @param {Record<string,string>} options.headers Original request headers
 * @param {string} options.environment 'sandbox' or 'production'
 * @param {(request: object) => Promise<object|null>} options.verifyProviderRequest
 *   Trusted provider-specific cryptographic verifier. Must reject tampered,
 *   unsigned, wrong-environment and wrong-merchant inputs. Its return must
 *   identify a purchase from the authenticated provider, not untrusted JSON.
 * @param {(purchase: object) => Promise<string|null>} options.resolveOwner
 *   Trusted immutable server-side purchase-to-user mapping, never request owner.
 * @param {string} options.expectedProviderEnvironment Explicit target environment
 * @returns {Promise<{status: string, fact?: object}>}
 */
export async function verifySubscriptionIngress(options) {
  const {
    provider, rawBody, headers, environment, verifyProviderRequest,
    resolveOwner, expectedProviderEnvironment,
  } = options ?? {};
  if (!providers.has(provider) || !(rawBody instanceof Uint8Array) ||
      rawBody.byteLength === 0 || rawBody.byteLength > 1024 * 1024 ||
      !headers || typeof headers !== 'object' ||
      !['sandbox', 'production'].includes(environment) ||
      environment !== expectedProviderEnvironment ||
      typeof verifyProviderRequest !== 'function' ||
      typeof resolveOwner !== 'function') {
    return { status: 'invalid_request' };
  }

  // Fail closed on verifier exceptions and ambiguous provider state.
  let authenticated;
  try {
    authenticated = await verifyProviderRequest({ provider, rawBody, headers, environment });
  } catch {
    return { status: 'verification_failed' };
  }
  if (!authenticated || authenticated.provider !== provider ||
      authenticated.environment !== environment ||
      !validAuthenticatedState(authenticated)) {
    return { status: 'verification_failed' };
  }

  let ownerId;
  try {
    ownerId = await resolveOwner({
      provider,
      providerSubscriptionId: authenticated.providerSubscriptionId,
      environment,
    });
  } catch {
    return { status: 'owner_unresolved' };
  }
  if (!safeId(ownerId)) return { status: 'owner_unresolved' };

  // Do not pass through metadata, actor identities, PII, unknown fields,
  // or account IDs contained in untrusted notifications.
  const fact = {
    ownerId,
    provider,
    providerSubscriptionId: authenticated.providerSubscriptionId,
    providerEventId: authenticated.providerEventId,
    revision: authenticated.revision,
    phase: authenticated.phase,
    accessUntil: authenticated.accessUntil,
  };
  return { status: 'verified_for_transaction', fact };
}
