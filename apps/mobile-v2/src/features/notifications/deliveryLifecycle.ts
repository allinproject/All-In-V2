/**
 * ALL-237 — fail-closed notification delivery lifecycle.
 *
 * This module determines the NEXT permitted operation. The canonical server
 * ledger owns storage and transactional claims. No network or push calls here.
 * A timeout after dispatch is ambiguous: never re-send without reconciliation,
 * even if the HTTP status would ordinarily be retryable.
 */
export type DeliveryState =
  | 'pending'
  | 'claimed'
  | 'ticket_accepted'
  | 'provider_accepted'
  | 'retry_wait'
  | 'needs_review'
  | 'canceled'
  | 'expired';

export type DeliverySnapshot = {
  ownerId: string;
  decisionKey: string;
  sourceRevision: string;
  currentSourceRevision: string;
  state: DeliveryState;
  attempt: number;
  expiresAt: string;
  now: string;
  /** If request may have left the server, a retry could produce two pushes. */
  dispatchStarted: boolean;
  lastAttemptAt: string | null;
  /** Version token for a server-side compare-and-swap; never a client authority. */
  ledgerVersion: number;
};

export type DeliveryOperation = 'claim' | 'wait' | 'reconcile' | 'expire' | 'cancel' | 'none';

function time(value: string): number | null {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function decideNextDeliveryOperation(
  snapshot: DeliverySnapshot,
  retryNotBefore: string | null,
): { operation: DeliveryOperation; reason: string } {
  if (!snapshot.ownerId.trim() || !snapshot.decisionKey.trim() || !snapshot.sourceRevision.trim() ||
      !Number.isSafeInteger(snapshot.ledgerVersion) || snapshot.ledgerVersion < 0 ||
      !Number.isSafeInteger(snapshot.attempt) || snapshot.attempt < 0) {
    return { operation: 'none', reason: 'invalid_ledger_identity' };
  }
  const now = time(snapshot.now);
  const expires = time(snapshot.expiresAt);
  if (now === null || expires === null) return { operation: 'none', reason: 'invalid_time' };
  if (snapshot.state === 'canceled' || snapshot.state === 'expired' || snapshot.state === 'provider_accepted') {
    return { operation: 'none', reason: 'terminal' };
  }
  if (snapshot.sourceRevision !== snapshot.currentSourceRevision) {
    return { operation: 'cancel', reason: 'source_changed' };
  }
  if (now >= expires) return { operation: 'expire', reason: 'delivery_expired' };
  if (snapshot.state === 'ticket_accepted') return { operation: 'reconcile', reason: 'await_receipt' };
  if (snapshot.state === 'needs_review') return { operation: 'none', reason: 'operator_review_required' };
  if (snapshot.state === 'claimed' || snapshot.dispatchStarted) {
    // Could have reached Expo even if no ticket was persisted.
    return { operation: 'reconcile', reason: 'possible_duplicate_send' };
  }
  if (snapshot.state !== 'pending' && snapshot.state !== 'retry_wait') {
    return { operation: 'none', reason: 'invalid_state' };
  }
  if (snapshot.state === 'retry_wait') {
    const retryAt = retryNotBefore === null ? null : time(retryNotBefore);
    if (retryAt === null) return { operation: 'none', reason: 'missing_retry_deadline' };
    if (retryAt > now) return { operation: 'wait', reason: 'backoff_active' };
  }
  return { operation: 'claim', reason: 'eligible_for_atomic_claim' };
}
