import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateNotification,
  isWithinQuietHours,
  notificationDecisionKey,
  type NotificationCandidate,
  type NotificationPreferences,
} from './notificationPolicy.ts';

const candidate: NotificationCandidate = {
  ownerId: 'owner-one',
  sourceId: 'workout-one',
  category: 'session_preparation',
  materialRevision: 'decision-1',
  priority: 'actionable',
  expiresAt: '2026-11-11T13:00:00Z',
  scheduledFor: '2026-11-11T11:00:00Z',
  sourceStatus: 'active',
  userResponse: 'none',
  actionableNow: true,
};
const now = '2026-11-11T12:00:00Z';
const prefs: NotificationPreferences = {
  pushPermission: true,
  pushEnabled: true,
  enabledCategories: { session_preparation: true, severe_weather: true },
  localMinuteOfDay: 600,
  quietStartMinute: 1320,
  quietEndMinute: 420,
  remainingPushBudget: 3,
  safetyPushEnabled: true,
  deliveredDecisionKeys: new Set(),
};

function decide(
  changes: Partial<NotificationCandidate> = {},
  settings: Partial<NotificationPreferences> = {},
  time = now,
) {
  return evaluateNotification({ ...candidate, ...changes }, { ...prefs, ...settings }, time);
}

test('authorized relevant notification is eligible for push', () => {
  assert.equal(decide().disposition, 'push');
});

test('dedupe key is stable and changes only on meaningful revision or identity', () => {
  const key = notificationDecisionKey(candidate);
  assert.equal(key, notificationDecisionKey({ ...candidate }));
  assert.notEqual(key, notificationDecisionKey({ ...candidate, materialRevision: 'decision-2' }));
  assert.notEqual(key, notificationDecisionKey({ ...candidate, ownerId: 'owner-two' }));
  assert.equal(decide({}, { deliveredDecisionKeys: new Set([key]) }).reason, 'already_delivered');
});

test('completed or canceled source, answered prompt, and stale delivery are suppressed', () => {
  for (const sourceStatus of ['completed', 'canceled', 'superseded'] as const) {
    assert.equal(decide({ sourceStatus }).disposition, 'suppress');
  }
  for (const userResponse of ['accepted', 'dismissed', 'declined', 'snoozed'] as const) {
    assert.equal(decide({ userResponse }).disposition, 'suppress');
  }
  assert.equal(decide({}, {}, '2026-11-11T14:00:00Z').reason, 'not_in_delivery_window');
  assert.equal(decide({ actionableNow: false }).reason, 'not_actionable');
});

test('push permission and opt-out are never bypassed', () => {
  assert.equal(decide({}, { pushPermission: false }).disposition, 'in_app');
  assert.equal(decide({}, { pushEnabled: false }).disposition, 'in_app');
  assert.equal(decide({}, { enabledCategories: {} }).disposition, 'suppress');
});

test('quiet hours work across midnight and optional content never pushes', () => {
  assert.equal(isWithinQuietHours(1430, 1320, 420), true);
  assert.equal(isWithinQuietHours(300, 1320, 420), true);
  assert.equal(isWithinQuietHours(720, 1320, 420), false);
  assert.equal(isWithinQuietHours(null, 1320, 420), null);
  assert.equal(decide({}, { localMinuteOfDay: 23 * 60 }).reason, 'quiet_hours');
  assert.equal(decide({ priority: 'optional' }).disposition, 'in_app');
});

test('notification budget and unknown time default to in-app only', () => {
  assert.equal(decide({}, { remainingPushBudget: 0 }).reason, 'push_budget_exhausted');
  assert.equal(decide({}, { localMinuteOfDay: null }).reason, 'unknown_local_time');
  assert.equal(decide({ scheduledFor: '2026-11-11T11:00:00' }).disposition, 'suppress');
});

test('verified safety alerts can override quiet and budget but not user permissions', () => {
  const alert: Partial<NotificationCandidate> = { priority: 'safety', category: 'severe_weather' };
  const settings: Partial<NotificationPreferences> = { localMinuteOfDay: 1400, remainingPushBudget: 0 };
  assert.equal(decide(alert, settings).reason, 'authorized_safety_alert');
  assert.equal(decide(alert, { ...settings, pushPermission: false }).disposition, 'in_app');
  assert.equal(decide(alert, { ...settings, safetyPushEnabled: false }).disposition, 'in_app');
  assert.equal(decide({ priority: 'safety' }).disposition, 'suppress');
});
