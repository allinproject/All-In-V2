import test from 'node:test';
import assert from 'node:assert/strict';
import { newPurchaseLedger, projectVerifiedPurchaseEvent, ledgerHasVerifiedAccess } from './verifiedPurchaseLedger.ts';

const base = {
  ownerId: 'owner-a', provider: 'app_store', providerSubscriptionId: 'app-1',
  providerEventId: 'event-1', revision: 1, phase: 'trial', accessUntil: 8000,
};
const apply = (ledger, fact, owner = 'owner-a') =>
  projectVerifiedPurchaseEvent(ledger, fact, owner);

test('first verified purchase is owner-bound, immutable and time-limited', () => {
  const empty = newPurchaseLedger('owner-a');
  const outcome = apply(empty, base);
  assert.equal(outcome.outcome, 'applied');
  assert.equal(Object.values(empty.purchases).length, 0);
  assert.equal(ledgerHasVerifiedAccess(outcome.ledger, 'owner-a', 7999), true);
  assert.equal(ledgerHasVerifiedAccess(outcome.ledger, 'owner-a', 8000), false);
  assert.equal(ledgerHasVerifiedAccess(outcome.ledger, 'owner-b', 2000), false);
});

test('owner switch and cross-account events never touch source ledger', () => {
  const first = apply(newPurchaseLedger('owner-a'), base).ledger;
  const attempt = apply(first, {...base, ownerId: 'owner-b', revision: 2, providerEventId: 'event-2'});
  assert.equal(attempt.outcome, 'wrong_owner');
  assert.equal(attempt.ledger, first);
  assert.equal(apply(first, {...base, revision:2, providerEventId:'event-2'}, 'owner-b').outcome, 'wrong_owner');
});

test('same provider event ID is only ever assigned to one purchase', () => {
  const first = apply(newPurchaseLedger('owner-a'), base).ledger;
  assert.equal(apply(first, base).outcome, 'duplicate');
  const cross = apply(first, {...base, providerSubscriptionId:'app-2'});
  assert.equal(cross.outcome, 'event_collision');
  assert.equal(cross.ledger, first);
});

test('duplicate and stale events cannot replay access after a revocation', () => {
  const first = apply(newPurchaseLedger('owner-a'), base).ledger;
  const revoked = apply(first, {...base, providerEventId:'revoke', revision:3, phase:'revoked'}).ledger;
  assert.equal(ledgerHasVerifiedAccess(revoked,'owner-a',1000),false);
  assert.equal(apply(revoked,base).outcome,'duplicate');
  assert.equal(apply(revoked,{...base,providerEventId:'late',revision:2}).outcome,'stale');
  assert.equal(ledgerHasVerifiedAccess(revoked,'owner-a',1000),false);
});

test('independent provider purchase remains valid after other purchase is refunded', () => {
  let ledger = apply(newPurchaseLedger('owner-a'), base).ledger;
  ledger = apply(ledger,{...base,provider:'stripe_web',providerSubscriptionId:'web-1',
    providerEventId:'event-1',phase:'paid', accessUntil:12000}).ledger;
  ledger = apply(ledger,{...base, providerEventId:'refund-app',revision:2,phase:'refunded'}).ledger;
  assert.equal(ledgerHasVerifiedAccess(ledger,'owner-a',9000),true);
  assert.equal(ledgerHasVerifiedAccess(ledger,'owner-a',12000),false);
});

test('empty and invalid event IDs never appear in durable projection', () => {
  const first = newPurchaseLedger('owner-a');
  assert.equal(apply(first,{...base,providerEventId:''}).outcome,'invalid');
  assert.equal(apply(first,{...base,accessUntil:null}).outcome,'invalid');
  assert.equal(Object.values(first.processedEvents).length,0);
});

test('out-of-order different purchase updates do not cross-clobber', () => {
  let ledger = apply(newPurchaseLedger('owner-a'),base).ledger;
  ledger = apply(ledger,{...base,providerSubscriptionId:'app-2',
    providerEventId:'event-2',revision:10,phase:'paid',accessUntil:15000}).ledger;
  ledger = apply(ledger,{...base,providerEventId:'cancel',revision:2,phase:'expired'}).ledger;
  assert.equal(ledgerHasVerifiedAccess(ledger,'owner-a',9000),true);
});

test('an expired or billing-retry-only ledger never grants paid access', () => {
  const result=apply(newPurchaseLedger('owner-a'), {...base,phase:'billing_retry'}).ledger;
  assert.equal(ledgerHasVerifiedAccess(result,'owner-a',1000),false);
  assert.equal(ledgerHasVerifiedAccess(newPurchaseLedger('owner-a'),'owner-a',1000),false);
});
