import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeV2DisplayName, profileOwnerMatches } from './profileEditor.ts';

test('display name normalizes whitespace and allows an empty optional name', () => {
  assert.equal(normalizeV2DisplayName('  Alex   Athlete  '), 'Alex Athlete');
  assert.equal(normalizeV2DisplayName('   '), null);
  assert.equal(normalizeV2DisplayName('A'.repeat(80)), 'A'.repeat(80));
});
test('display name rejects oversized values and control characters', () => {
  assert.throws(() => normalizeV2DisplayName('A'.repeat(81)), /80 characters/);
  assert.throws(() => normalizeV2DisplayName('Test\u0000Name'), /control characters/);
});
test('owner profile identity is mandatory and never inferred from email', () => {
  assert.equal(profileOwnerMatches({ user_id: 'athlete-a', display_name: 'A' }, 'athlete-a'), true);
  assert.equal(profileOwnerMatches({ user_id: 'athlete-b', email: 'same@example.com' }, 'athlete-a'), false);
  assert.equal(profileOwnerMatches({ display_name: 'A' }, 'athlete-a'), false);
  assert.equal(profileOwnerMatches(null, 'athlete-a'), false);
});
