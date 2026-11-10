import test from 'node:test';
import assert from 'node:assert/strict';
import { authRouteState, isV2AccessAttemptCurrent, shouldApplyV2AuthEvent, shouldOfferV2ConfirmationResend } from './authRoute.ts';

test('auth routing remains loading until session restoration settles', () => {
  assert.deepEqual(authRouteState({ loading: true, userId: null }), { state: 'loading' });
});

test('missing or blank identity routes to sign-in', () => {
  assert.deepEqual(authRouteState({ loading: false }), { state: 'signed_out' });
  assert.deepEqual(authRouteState({ loading: false, userId: '  ' }), { state: 'signed_out' });
});

test('existing authenticated identity routes to signed-in app', () => {
  assert.deepEqual(authRouteState({ loading: false, userId: 'user-123' }), {
    state: 'signed_in',
    userId: 'user-123',
  });
});
test('confirmation resend remains available only for the email rejected as unconfirmed', () => {
  assert.equal(shouldOfferV2ConfirmationResend(null, 'athlete@example.com'), false);
  assert.equal(shouldOfferV2ConfirmationResend('athlete@example.com', 'athlete@example.com'), true);
  assert.equal(shouldOfferV2ConfirmationResend('athlete@example.com', ' Athlete@Example.COM '), true);
  assert.equal(shouldOfferV2ConfirmationResend('athlete@example.com', 'other@example.com'), false);
  assert.equal(shouldOfferV2ConfirmationResend('athlete@example.com', ''), false);
});

test('bootstrap auth state cannot overwrite a later sign-in, token refresh or sign-out', () => {
  assert.equal(shouldApplyV2AuthEvent('INITIAL_SESSION', false), true);
  assert.equal(shouldApplyV2AuthEvent('SIGNED_IN', false), true);
  assert.equal(shouldApplyV2AuthEvent('SIGNED_OUT', true), true);
  assert.equal(shouldApplyV2AuthEvent('TOKEN_REFRESHED', true), true);
  assert.equal(shouldApplyV2AuthEvent('USER_UPDATED', true), true);
  assert.equal(shouldApplyV2AuthEvent('INITIAL_SESSION', true), false);
});

test('access gate fails closed immediately when retry attempt or account changes', () => {
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 2, false), true);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 3, false), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-b', 2, false), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, null, 2, false), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 2, true), false);
  assert.equal(isV2AccessAttemptCurrent(null, 2, 'user-a', 2, false), false);
});
