/**
 * ALL-252: Pure, provider-neutral V2 subscription reconciliation contract.
 *
 * IMPORTANT: The server must verify provider signatures/transactions before
 * constructing these facts. This module never authenticates a client claim,
 * performs payment operations, or grants an entitlement by itself.
 */
export type SubscriptionProvider = 'app_store' | 'google_play' | 'stripe_web';
export type SubscriptionPhase =
  | 'trial'
  | 'paid'
  | 'grace'
  | 'billing_retry'
  | 'canceling'
  | 'expired'
  | 'refunded'
  | 'revoked';

export type VerifiedSubscriptionFact = Readonly<{
  ownerId: string;
  provider: SubscriptionProvider;
  providerSubscriptionId: string;
  providerEventId: string;
  revision: number;
  phase: SubscriptionPhase;
  accessUntil: number | null; // Trusted Unix milliseconds, exclusive.
}>;

export type SubscriptionSnapshot = VerifiedSubscriptionFact;
export type ReconcileResult = Readonly<{
  snapshot: SubscriptionSnapshot | null;
  result: 'applied' | 'duplicate' | 'stale' | 'wrong_owner' | 'different_purchase' | 'invalid';
}>;

const entitledPhases: ReadonlySet<SubscriptionPhase> = new Set(['trial', 'paid', 'grace', 'canceling']);
const phases: ReadonlySet<string> = new Set([
  'trial', 'paid', 'grace', 'billing_retry', 'canceling', 'expired', 'refunded', 'revoked',
]);
const providers: ReadonlySet<string> = new Set(['app_store', 'google_play', 'stripe_web']);

function wellFormed(f: VerifiedSubscriptionFact): boolean {
  return !!f.ownerId?.trim() && !!f.providerSubscriptionId?.trim() &&
    !!f.providerEventId?.trim() && providers.has(f.provider) && phases.has(f.phase) &&
    Number.isSafeInteger(f.revision) && f.revision >= 0 &&
    (f.accessUntil === null || (Number.isSafeInteger(f.accessUntil) && f.accessUntil >= 0)) &&
    (!entitledPhases.has(f.phase) || f.accessUntil !== null);
}

/**
 * Reconcile only facts authenticated by a trusted backend adapter. Revisions
 * are monotonic within ONE provider subscription, NOT across providers.
 * Separate purchase identities require an explicit server-side reconciliation.
 */
export function reconcileSubscription(
  current: SubscriptionSnapshot | null,
  next: VerifiedSubscriptionFact,
  expectedOwnerId: string,
): ReconcileResult {
  if (!expectedOwnerId?.trim() || !wellFormed(next) || (current !== null && !wellFormed(current))) {
    return { snapshot: current, result: 'invalid' };
  }
  if (next.ownerId !== expectedOwnerId || (current && current.ownerId !== expectedOwnerId)) {
    return { snapshot: current, result: 'wrong_owner' };
  }
  if (!current) return { snapshot: next, result: 'applied' };
  if (current.provider !== next.provider || current.providerSubscriptionId !== next.providerSubscriptionId) {
    return { snapshot: current, result: 'different_purchase' };
  }
  if (current.providerEventId === next.providerEventId) return { snapshot: current, result: 'duplicate' };
  if (next.revision <= current.revision) return { snapshot: current, result: 'stale' };
  return { snapshot: next, result: 'applied' };
}

/** Display/read-only decision. Never use a client-side result as proof of purchase. */
export function subscriptionAccess(
  snapshot: SubscriptionSnapshot | null,
  expectedOwnerId: string,
  now: number,
): 'entitled' | 'not_entitled' {
  if (!snapshot || snapshot.ownerId !== expectedOwnerId || !wellFormed(snapshot) ||
      !Number.isSafeInteger(now) || now < 0) return 'not_entitled';
  return entitledPhases.has(snapshot.phase) && snapshot.accessUntil !== null &&
    now < snapshot.accessUntil ? 'entitled' : 'not_entitled';
}
