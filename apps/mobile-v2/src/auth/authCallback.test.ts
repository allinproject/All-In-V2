import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthCallback } from './authCallback.ts';

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
