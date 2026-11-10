import test from 'node:test';
import assert from 'node:assert/strict';
import { advancesV2AuthSessionGeneration, authRouteState, canStartV2SignedOutAction, createV2AuthActionGuard, isV2AccessAttemptCurrent, shouldApplyV2AuthEvent, shouldOfferV2ConfirmationResend, v2AuthenticatedScreenKey } from './authRoute.ts';

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

test('access gate fails closed on retry, owner change, or a new session for the same user', () => {
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 2, false, 4, 4), true);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 3, false, 4, 4), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-b', 2, false, 4, 4), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, null, 2, false, 4, 4), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 2, true, 4, 4), false);
  assert.equal(isV2AccessAttemptCurrent(null, 2, 'user-a', 2, false, 4, 4), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 2, false, 4, 5), false);
  assert.equal(isV2AccessAttemptCurrent('user-a', 2, 'user-a', 2, false, 5, 5), true);
});

test('only sign-in and sign-out change the session identity generation', () => {
  assert.equal(advancesV2AuthSessionGeneration('SIGNED_IN'), true);
  assert.equal(advancesV2AuthSessionGeneration('SIGNED_OUT'), true);
  assert.equal(advancesV2AuthSessionGeneration('INITIAL_SESSION'), false);
  assert.equal(advancesV2AuthSessionGeneration('TOKEN_REFRESHED'), false);
  assert.equal(advancesV2AuthSessionGeneration('USER_UPDATED'), false);
});

test('home auth UI state is isolated across account and session changes', () => {
  const first = v2AuthenticatedScreenKey('user-a', 3);
  assert.equal(first, v2AuthenticatedScreenKey('user-a', 3));
  assert.notEqual(first, v2AuthenticatedScreenKey('user-a', 4));
  assert.notEqual(first, v2AuthenticatedScreenKey('user-b', 3));
  assert.notEqual(first, v2AuthenticatedScreenKey(null, 3));
});

test('local auth action guard rejects rapid repeated sign-out and releases after errors', () => {
  const guard = createV2AuthActionGuard();
  assert.equal(guard.isBusy(), false);
  assert.equal(guard.tryEnter(), true);
  assert.equal(guard.isBusy(), true);
  assert.equal(guard.tryEnter(), false);
  guard.leave();
  assert.equal(guard.isBusy(), false);
  assert.equal(guard.tryEnter(), true);
  guard.leave();
});

test('direct sign-in and signup block requests while auth restores or an account is present', () => {
  assert.equal(canStartV2SignedOutAction(true, null), false);
  assert.equal(canStartV2SignedOutAction(true, 'user-a'), false);
  assert.equal(canStartV2SignedOutAction(false, 'user-a'), false);
  assert.equal(canStartV2SignedOutAction(false, '  '), true);
  assert.equal(canStartV2SignedOutAction(false, null), true);
});
