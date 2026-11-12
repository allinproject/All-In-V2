import test from 'node:test';
import assert from 'node:assert/strict';
import { goalReviewPresentation, type GoalApprovalPreview } from './goalReviewPresentation.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-11-12T12:00:00Z');
function valid(): GoalApprovalPreview {
  return {
    ownerId: owner, authSessionGeneration: 3, complete: true, nextCursor: null,
    goalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    goalRevisionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    expectedVersion: 2, goalTitle: 'Enjoy moving more', goalKind: 'general_wellbeing',
    goalStatus: 'active', priority: 'primary', targetDate: null,
    sha256: 'a'.repeat(64), expiresAt: new Date(now + 5 * 60_000).toISOString(),
    behaviors: [{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      description: 'Walk when it feels right', cadence: null, evidenceSource: null,
      userConfirmed: false,
    }],
  };
}
test('no backend reader never fabricates an empty Goal list or approval', () => {
  const state = goalReviewPresentation(null, owner, 3, now);
  assert.equal(state.status, 'unavailable');
  assert.match(state.message, /not connected/);
  assert.equal(state.preview, null);
});
test('exact same-owner session and intact undated Goal show review only', () => {
  const state = goalReviewPresentation(valid(), owner, 3, now);
  assert.equal(state.status, 'review_required');
  if (state.status !== 'review_required') throw Error(state.message);
  assert.equal(state.preview.targetDate, null);
  assert.equal(state.preview.behaviors[0]?.userConfirmed, false);
  assert.equal(Object.hasOwn(state, 'approved'), false);
  assert.equal(Object.hasOwn(state.preview, 'reviewId'), false);
  assert.equal(Object.hasOwn(state.preview, 'actionId'), false);
});
test('account switches, session rotations and incomplete evidence fail closed', () => {
  for (const [p, id, generation] of [
    [valid(), other, 3],
    [valid(), owner, 4],
    [{...valid(),complete:false},owner,3],
    [{...valid(),nextCursor:'next'},owner,3],
  ] as const) {
    assert.equal(goalReviewPresentation(p as GoalApprovalPreview, id, generation, now).status,
      'unavailable');
  }
});
test('stale previews, invalid IDs and tampered digests are rejected', () => {
  for (const p of [
    {...valid(), expiresAt: new Date(now - 1).toISOString()},
    {...valid(), expiresAt: new Date(now + 16 * 60_000).toISOString()},
    {...valid(), sha256: 'client-calculated'},
    {...valid(), goalId: 'bad'},
    {...valid(), goalRevisionId: 'bad'},
    {...valid(), expectedVersion: 0},
    {...valid(), targetDate: '2027-02-30'},
  ]) assert.equal(goalReviewPresentation(p, owner, 3, now).status,'unavailable');
});
test('duplicate or invalid behaviors cannot be presented as an accepted review', () => {
  const p = valid();
  assert.equal(goalReviewPresentation({...p,behaviors:[...p.behaviors,...p.behaviors]},
    owner,3,now).status,'unavailable');
  assert.equal(goalReviewPresentation({...p,behaviors:[{...p.behaviors[0]!, id:'invalid'}]},
    owner,3,now).status,'unavailable');
});
