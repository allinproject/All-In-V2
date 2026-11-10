import test from 'node:test';
import assert from 'node:assert/strict';
import { authRouteState, shouldOfferV2ConfirmationResend } from './authRoute.ts';

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
