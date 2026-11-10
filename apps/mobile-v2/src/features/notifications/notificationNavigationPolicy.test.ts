import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNotificationOpen, type NotificationOpenIntent } from './notificationNavigationPolicy.ts';

const intent: NotificationOpenIntent = {
  ownerId: 'owner-a', decisionKey: 'decision', target: 'train', sourceId: 'workout-1',
};

test('authorized current owner may navigate only after server-verified access', () => {
  assert.deepEqual(resolveNotificationOpen(intent, 'owner-a', true), {
    allowed: true, route: '/train', sourceId: 'workout-1',
  });
  assert.equal(resolveNotificationOpen(intent, 'owner-a', false).allowed, false);
});

test('signed out and changed account cannot open prior athlete notification', () => {
  assert.deepEqual(resolveNotificationOpen(intent, null, true), { allowed: false, reason: 'signed_out' });
  assert.deepEqual(resolveNotificationOpen(intent, 'owner-b', true), { allowed: false, reason: 'wrong_owner' });
});

test('arbitrary URLs, missing source IDs and unfamiliar routes fail closed', () => {
  assert.equal(resolveNotificationOpen({ ...intent, target: 'https://evil.example' as never }, 'owner-a', true).allowed, false);
  assert.equal(resolveNotificationOpen({ ...intent, target: '__proto__' as never }, 'owner-a', true).allowed, false);
  assert.equal(resolveNotificationOpen({ ...intent, sourceId: '' }, 'owner-a', true).allowed, false);
});

test('all approved destinations are fixed app-internal routes', () => {
  for (const target of ['today', 'train', 'coach', 'fuel', 'community'] as const) {
    const result = resolveNotificationOpen({ ...intent, target }, 'owner-a', true);
    assert.equal(result.allowed, true);
    if (result.allowed) assert.ok(result.route.startsWith('/'));
  }
});
