import { reconcileSubscription, subscriptionAccess } from './entitlementContract.ts';
import type { VerifiedSubscriptionFact, SubscriptionSnapshot } from './entitlementContract.ts';

/**
 * ALL-252: Pure projection for a future server-owned, transactional event ledger.
 * DO NOT expose this module as a client mutation API or accept unsigned provider
 * webhooks directly. Verification and database locking must precede projection.
 */
export type VerifiedPurchaseLedger = Readonly<{
  ownerId: string;
  purchases: Readonly<Record<string, SubscriptionSnapshot>>;
  processedEvents: Readonly<Record<string, string>>;
}>;

export type LedgerDecision = Readonly<{
  ledger: VerifiedPurchaseLedger;
  outcome: 'applied' | 'duplicate' | 'stale' | 'wrong_owner' | 'invalid' | 'event_collision';
}>;

const keyFor = (provider: string, subscriptionId: string): string =>
  JSON.stringify([provider, subscriptionId]);
const eventKeyFor = (provider: string, eventId: string): string =>
  JSON.stringify([provider, eventId]);

export function newPurchaseLedger(ownerId: string): VerifiedPurchaseLedger {
  return { ownerId, purchases: Object.create(null), processedEvents: Object.create(null) };
}

/**
 * The caller MUST verify the provider's authenticated event and the immutable
 * server-side purchase-to-owner mapping first, and atomically persist the
 * returned snapshot + processed-event ID in one DB transaction.
 */
export function projectVerifiedPurchaseEvent(
  ledger: VerifiedPurchaseLedger,
  fact: VerifiedSubscriptionFact,
  expectedOwnerId: string,
): LedgerDecision {
  if (!expectedOwnerId?.trim() || !ledger?.ownerId?.trim() ||
      !ledger.purchases || !ledger.processedEvents || !fact) {
    return { ledger, outcome: 'invalid' };
  }
  if (ledger.ownerId !== expectedOwnerId || fact.ownerId !== expectedOwnerId) {
    return { ledger, outcome: 'wrong_owner' };
  }
  const purchaseKey = keyFor(fact.provider, fact.providerSubscriptionId);
  const eventKey = eventKeyFor(fact.provider, fact.providerEventId);
  const existing = Object.hasOwn(ledger.purchases, purchaseKey) ? ledger.purchases[purchaseKey] : null;
  // Refuse invalid facts before ever recording their event ID.
  const projection = reconcileSubscription(existing, fact, expectedOwnerId);
  if (projection.result === 'invalid' || projection.result === 'wrong_owner' ||
      projection.result === 'different_purchase') {
    return { ledger, outcome: projection.result === 'wrong_owner' ? 'wrong_owner' : 'invalid' };
  }
  const originalPurchaseKey = ledger.processedEvents[eventKey];
  if (originalPurchaseKey !== undefined) {
    return { ledger, outcome: originalPurchaseKey === purchaseKey ? 'duplicate' : 'event_collision' };
  }
  if (projection.result === 'stale' || projection.result === 'duplicate') {
    return { ledger, outcome: projection.result };
  }
  if (!projection.snapshot) return { ledger, outcome: 'invalid' };
  return {
    outcome: 'applied',
    ledger: {
      ownerId: ledger.ownerId,
      purchases: { ...ledger.purchases, [purchaseKey]: projection.snapshot },
      processedEvents: { ...ledger.processedEvents, [eventKey]: purchaseKey },
    },
  };
}

/**
 * Read-only aggregation across independently verified purchases. A revoked
 * subscription cannot clear a DIFFERENT provider purchase or account.
 */
export function ledgerHasVerifiedAccess(
  ledger: VerifiedPurchaseLedger,
  expectedOwnerId: string,
  now: number,
): boolean {
  if (!ledger || ledger.ownerId !== expectedOwnerId || !expectedOwnerId?.trim()) return false;
  return Object.values(ledger.purchases).some(purchase =>
    subscriptionAccess(purchase, expectedOwnerId, now) === 'entitled');
}
