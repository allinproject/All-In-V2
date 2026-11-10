import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PASSWORD_LENGTH, meetsV2PasswordMinimum } from './passwordPolicy.ts';

test('V2 password policy matches the configured 12-character provider minimum', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(meetsV2PasswordMinimum('a'.repeat(11)), false);
  assert.equal(meetsV2PasswordMinimum('a'.repeat(12)), true);
  assert.equal(meetsV2PasswordMinimum('a'.repeat(32)), true);
  assert.equal(meetsV2PasswordMinimum(''), false);
});
