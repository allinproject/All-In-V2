import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSubscription, subscriptionAccess } from './entitlementContract.ts';

const base = Object.freeze({
  ownerId: 'athlete-a',
  provider: 'app_store',
  providerSubscriptionId: 'purchase-1',
  providerEventId: 'event-1',
  revision: 1,
  phase: 'trial',
  accessUntil: 7000,
});

test('only an authenticated owner-bound trial fact gives time-limited access', () => {
  const result = reconcileSubscription(null, base, 'athlete-a');
  assert.equal(result.result, 'applied');
  assert.equal(subscriptionAccess(result.snapshot, 'athlete-a', 6999), 'entitled');
  assert.equal(subscriptionAccess(result.snapshot, 'athlete-a', 7000), 'not_entitled');
  assert.equal(subscriptionAccess(result.snapshot, 'athlete-b', 6000), 'not_entitled');
});

test('other owner cannot inject a new or updated subscription', () => {
  assert.equal(reconcileSubscription(null, base, 'athlete-b').result, 'wrong_owner');
  const other = {...base, ownerId: 'athlete-b', providerEventId: 'event-2', revision: 2};
  assert.equal(reconcileSubscription(base, other, 'athlete-a').result, 'wrong_owner');
  assert.equal(reconcileSubscription(base, other, 'athlete-a').snapshot, base);
});

test('duplicate provider events and out-of-order revisions are idempotently ignored', () => {
  assert.equal(reconcileSubscription(base, base, 'athlete-a').result, 'duplicate');
  const older = {...base, providerEventId: 'older', revision: 0, phase: 'paid'};
  assert.equal(reconcileSubscription(base, older, 'athlete-a').result, 'stale');
  const tie = {...base, providerEventId: 'other', revision: 1, phase: 'paid'};
  assert.equal(reconcileSubscription(base, tie, 'athlete-a').result, 'stale');
});

test('separate providers or purchase identities cannot silently replace each other', () => {
  assert.equal(reconcileSubscription(base, {...base, provider: 'stripe_web', revision: 100}, 'athlete-a').result, 'different_purchase');
  assert.equal(reconcileSubscription(base, {...base, providerSubscriptionId: 'other', revision: 100}, 'athlete-a').result, 'different_purchase');
});

test('renewal extends access only when a newer provider fact arrives', () => {
  const paid = {...base, phase: 'paid', revision: 2, providerEventId: 'renewal', accessUntil: 14000};
  const result = reconcileSubscription(base, paid, 'athlete-a');
  assert.equal(result.result, 'applied');
  assert.equal(subscriptionAccess(result.snapshot, 'athlete-a', 10000), 'entitled');
  assert.equal(subscriptionAccess(base, 'athlete-a', 10000), 'not_entitled');
});

test('canceling remains entitled through its verified expiration but not afterward', () => {
  const canceled = {...base, phase: 'canceling', revision: 2, providerEventId: 'cancel', accessUntil: 8000};
  assert.equal(subscriptionAccess(canceled, 'athlete-a', 7999), 'entitled');
  assert.equal(subscriptionAccess(canceled, 'athlete-a', 8000), 'not_entitled');
});

test('grace remains time-bounded; billing retry alone grants no access', () => {
  assert.equal(subscriptionAccess({...base, phase: 'grace'}, 'athlete-a', 6999), 'entitled');
  assert.equal(subscriptionAccess({...base, phase: 'billing_retry'}, 'athlete-a', 6999), 'not_entitled');
});

test('refund, revoke and expiry terminate access without waiting for old period end', () => {
  for (const phase of ['expired', 'refunded', 'revoked']) {
    const next = {...base, phase, providerEventId: phase, revision: 2, accessUntil: 99000};
    const result = reconcileSubscription(base, next, 'athlete-a');
    assert.equal(result.result, 'applied');
    assert.equal(subscriptionAccess(result.snapshot, 'athlete-a', 6000), 'not_entitled');
  }
});

test('malformed facts never grant access, including missing access end', () => {
  for (const malformed of [
    {...base, revision: -1},
    {...base, revision: Number.NaN},
    {...base, accessUntil: null},
    {...base, provider: 'unverified' },
    {...base, providerEventId: '' },
  ]) {
    assert.equal(reconcileSubscription(null, malformed, 'athlete-a').result, 'invalid');
    assert.equal(subscriptionAccess(malformed, 'athlete-a', 2000), 'not_entitled');
  }
});

test('pure contract never mutates input facts', () => {
  const before = JSON.stringify(base);
  reconcileSubscription(base, {...base, providerEventId: 'new', revision: 2}, 'athlete-a');
  subscriptionAccess(base, 'athlete-a', 2000);
  assert.equal(JSON.stringify(base), before);
});
