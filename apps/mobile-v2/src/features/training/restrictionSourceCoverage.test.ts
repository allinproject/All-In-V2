import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightRestrictionSourceCoverage, REQUIRED_RESTRICTION_SOURCES, type RestrictionSourceEvidence } from './restrictionSourceCoverage.ts';

const owner = 'athlete-a';
const version = 'owner-snapshot-11';
const sources: RestrictionSourceEvidence[] = REQUIRED_RESTRICTION_SOURCES.map(kind => ({
  kind, ownerId: owner, complete: true, nextCursor: null,
  snapshotVersion: version, inspectedCount: 0, reconciledCount: 0, unresolvedCount: 0,
}));
const input = { expectedOwnerId: owner, authenticatedOwnerId: owner, snapshotVersion: version, sources };
const check = (changes: Partial<typeof input>) => preflightRestrictionSourceCoverage({ ...input, ...changes });

test('complete zero-row source inventory does not authorize certification', () => {
  assert.deepEqual(check({}), { status: 'review_required', ownerId: owner, snapshotVersion: version });
});
test('missing history or restore source rejects even an empty canonical inventory', () => {
  assert.equal(check({ sources: sources.filter(s => s.kind !== 'restored_records') }).status, 'blocked');
  assert.equal(check({ sources: [] }).status, 'blocked');
});
test('cross-owner session, source or duplicate source rejects', () => {
  assert.equal(check({ authenticatedOwnerId: 'athlete-b' }).status, 'blocked');
  assert.equal(check({ authenticatedOwnerId: null }).status, 'blocked');
  assert.equal(check({ sources: sources.map((s, i) => i === 1 ? { ...s, ownerId: 'athlete-b' } : s) }).status, 'blocked');
  assert.equal(check({ sources: [...sources, sources[0]] }).status, 'blocked');
});
test('incomplete page, stale version, unresolved mismatch and bad count reject', () => {
  for (const change of [
    { complete: false }, { nextCursor: 'next' }, { snapshotVersion: 'old' },
    { snapshotVersion: '' }, { inspectedCount: 2, reconciledCount: 1 },
    { inspectedCount: 1, reconciledCount: 1, unresolvedCount: 1 },
    { inspectedCount: -1 }, { inspectedCount: 1.5 },
  ]) {
    assert.equal(check({ sources: [{ ...sources[0], ...change }, ...sources.slice(1)] }).status, 'blocked', JSON.stringify(change));
  }
});
test('unknown, malformed or absent source list rejects', () => {
  assert.equal(check({ sources: [...sources, { ...sources[0], kind: 'unknown' as never }] }).status, 'blocked');
  assert.equal(check({ sources: [null as never, ...sources] }).status, 'blocked');
  assert.equal(check({ sources: null as never }).status, 'blocked');
});
