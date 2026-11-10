import assert from 'node:assert/strict';
import test from 'node:test';
import { decideNextDeliveryOperation, type DeliverySnapshot } from './deliveryLifecycle.ts';

const snapshot: DeliverySnapshot = {
  ownerId: 'owner-v2', decisionKey: 'decision-1', sourceRevision: 'r1',
  currentSourceRevision: 'r1', state: 'pending', attempt: 0,
  expiresAt: '2026-11-11T15:00:00Z', now: '2026-11-11T12:00:00Z',
  dispatchStarted: false, lastAttemptAt: null, ledgerVersion: 0,
};

test('pending valid decision may only claim, never send directly', () => {
  assert.deepEqual(decideNextDeliveryOperation(snapshot, null), {
    operation: 'claim', reason: 'eligible_for_atomic_claim',
  });
});

test('a send with an ambiguous outcome is reconciled rather than resent', () => {
  assert.equal(decideNextDeliveryOperation({ ...snapshot, state: 'claimed' }, null).operation, 'reconcile');
  assert.equal(decideNextDeliveryOperation({ ...snapshot, dispatchStarted: true, state: 'retry_wait' }, null).operation, 'reconcile');
  assert.equal(decideNextDeliveryOperation({ ...snapshot, state: 'ticket_accepted' }, null).reason, 'await_receipt');
});

test('a changed workout revision cancels queued reminders, including retries', () => {
  assert.equal(decideNextDeliveryOperation({ ...snapshot, currentSourceRevision: 'r2' }, null).operation, 'cancel');
});

test('expired items never get another delivery attempt', () => {
  assert.equal(decideNextDeliveryOperation({ ...snapshot, now: snapshot.expiresAt }, null).operation, 'expire');
  assert.equal(decideNextDeliveryOperation({ ...snapshot, state: 'expired' }, null).operation, 'none');
  assert.equal(decideNextDeliveryOperation({ ...snapshot, state: 'provider_accepted' }, null).operation, 'none');
});

test('backoff must be verified, elapsed and timezone-aware', () => {
  const waiting = { ...snapshot, state: 'retry_wait' as const, attempt: 2 };
  assert.equal(decideNextDeliveryOperation(waiting, '2026-11-11T13:00:00Z').operation, 'wait');
  assert.equal(decideNextDeliveryOperation(waiting, '2026-11-11T11:00:00Z').operation, 'claim');
  assert.equal(decideNextDeliveryOperation(waiting, null).operation, 'none');
  assert.equal(decideNextDeliveryOperation(waiting, '2026-11-11T11:00:00').operation, 'none');
});

test('missing owner, corrupt version or non-timezone inputs fail closed', () => {
  assert.equal(decideNextDeliveryOperation({ ...snapshot, ownerId: '' }, null).operation, 'none');
  assert.equal(decideNextDeliveryOperation({ ...snapshot, ledgerVersion: -1 }, null).operation, 'none');
  assert.equal(decideNextDeliveryOperation({ ...snapshot, now: '2026-11-11T12:00:00' }, null).operation, 'none');
});
