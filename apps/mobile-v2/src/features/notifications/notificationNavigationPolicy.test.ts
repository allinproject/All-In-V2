import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNotificationOpen, type NotificationOpenIntent } from './notificationNavigationPolicy.ts';

const intent: NotificationOpenIntent = {
  ownerId: 'owner-a', decisionKey: 'decision', target: 'today', sourceId: 'workout-1',
};

test('only mounted home is navigable after current-owner and legal/onboarding verification', () => {
  assert.deepEqual(resolveNotificationOpen(intent, 'owner-a', true, true), {
    allowed: true, route: '/home', sourceId: 'workout-1',
  });
  assert.deepEqual(resolveNotificationOpen(intent, 'owner-a', true, false), {
    allowed: false, reason: 'access_not_verified',
  });
  assert.equal(resolveNotificationOpen(intent, 'owner-a', false, true).allowed, false);
});

test('signed out and changed accounts cannot open prior athlete notification', () => {
  assert.deepEqual(resolveNotificationOpen(intent, null, true, true), { allowed: false, reason: 'signed_out' });
  assert.deepEqual(resolveNotificationOpen(intent, 'owner-b', true, true), { allowed: false, reason: 'wrong_owner' });
});

test('arbitrary URLs, prototype keys and missing identity fail closed', () => {
  assert.equal(resolveNotificationOpen({ ...intent, target: 'https://evil.example' as never }, 'owner-a', true, true).allowed, false);
  assert.equal(resolveNotificationOpen({ ...intent, target: '__proto__' as never }, 'owner-a', true, true).allowed, false);
  assert.equal(resolveNotificationOpen({ ...intent, sourceId: '' }, 'owner-a', true, true).allowed, false);
});

test('future five-tab destinations fail closed until their real screens are mounted', () => {
  for (const target of ['train', 'coach', 'fuel', 'community'] as const) {
    assert.deepEqual(resolveNotificationOpen({ ...intent, target }, 'owner-a', true, true), {
      allowed: false, reason: 'destination_unavailable',
    });
  }
});
