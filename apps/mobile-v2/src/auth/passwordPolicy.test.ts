import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PASSWORD_LENGTH, meetsV2PasswordMinimum, v2PasswordResetValidationError } from './passwordPolicy.ts';

test('V2 password policy matches the configured 12-character provider minimum', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(meetsV2PasswordMinimum('a'.repeat(11)), false);
  assert.equal(meetsV2PasswordMinimum('a'.repeat(12)), true);
  assert.equal(meetsV2PasswordMinimum('a'.repeat(32)), true);
  assert.equal(meetsV2PasswordMinimum(''), false);
});

test('V2 password reset rejects short and mismatched confirmation before any provider request', () => {
  assert.match(v2PasswordResetValidationError('a'.repeat(11), 'a'.repeat(11)) ?? '', /12 characters/);
  assert.equal(v2PasswordResetValidationError('a'.repeat(12), 'b'.repeat(12)), 'The passwords do not match.');
  assert.equal(v2PasswordResetValidationError('a'.repeat(12), 'a'.repeat(12)), null);
  assert.equal(v2PasswordResetValidationError('valid secure password', 'valid secure password'), null);
});
