import test from 'node:test';
import assert from 'node:assert/strict';
import { authCallbackRequestKey, resolveAuthCallback } from './authCallback.ts';

test('email confirmation callback exchanges the first code and returns to the access gate', () => {
  assert.deepEqual(resolveAuthCallback({ code: 'code-123', type: 'signup' }), {
    kind: 'exchange',
    code: 'code-123',
    destination: 'app',
  });
});

test('password recovery callback routes to password reset after code exchange', () => {
  assert.deepEqual(resolveAuthCallback({ code: ['recovery-code', 'ignored'], type: ['recovery'] }), {
    kind: 'exchange',
    code: 'recovery-code',
    destination: 'reset-password',
  });
});

test('missing code and provider errors fail closed', () => {
  assert.equal(resolveAuthCallback({}).kind, 'error');
  assert.equal(resolveAuthCallback({ error: 'access_denied', code: 'code-123' }).kind, 'error');
  assert.equal(resolveAuthCallback({ error_description: 'expired' }).kind, 'error');
});

test('callback request identity deduplicates rerenders but accepts a fresh email link', () => {
  const expired = { code: 'expired', type: 'recovery' };
  const fresh = { code: 'fresh', type: 'recovery' };
  assert.equal(authCallbackRequestKey(expired), authCallbackRequestKey({ ...expired }));
  assert.notEqual(authCallbackRequestKey(expired), authCallbackRequestKey(fresh));
  assert.notEqual(authCallbackRequestKey({ code: 'same', type: 'signup' }), authCallbackRequestKey({ code: 'same', type: 'recovery' }));
});

test('callback request identity distinguishes provider errors and subsequent valid links', () => {
  assert.notEqual(
    authCallbackRequestKey({ error: 'access_denied', error_description: 'expired' }),
    authCallbackRequestKey({ code: 'new-code', type: 'signup' }),
  );
  assert.notEqual(
    authCallbackRequestKey({ error: 'access_denied', error_description: 'expired' }),
    authCallbackRequestKey({ error: 'access_denied', error_description: 'different' }),
  );
});

test('google oauth callback uses the same PKCE exchange and access gate', () => {
  assert.deepEqual(resolveAuthCallback({ code: 'google-pkce-code' }), {
    kind: 'exchange',
    code: 'google-pkce-code',
    destination: 'app',
  });
  assert.notEqual(authCallbackRequestKey({ code: 'google-pkce-code' }), authCallbackRequestKey({ error: 'access_denied' }));
});
