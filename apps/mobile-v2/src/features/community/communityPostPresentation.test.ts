import test from 'node:test';
import assert from 'node:assert/strict';
import { propsActionLabel, propsCountLabel, commentCountLabel, communityPostPrimaryAction, communityPostCommentAction } from './communityPostPresentation.ts';

test('ALL IN community terminology uses Props for both reaction states', () => {
  assert.equal(propsActionLabel(false), 'Give Props');
  assert.equal(propsActionLabel(true), 'Remove Props');
  assert.equal(propsCountLabel(0), 'Props · 0');
  assert.equal(propsCountLabel(12), 'Props · 12');
  assert.equal(commentCountLabel(3), 'Comment · 3');
});
test('counts are never silently fabricated or rounded', () => {
  for (const invalid of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => propsCountLabel(invalid));
    assert.throws(() => commentCountLabel(invalid));
  }
});
test('post primary tap goes to domain detail while comments keep their own action', () => {
  assert.equal(communityPostPrimaryAction('workout'), 'completed-activity');
  assert.equal(communityPostPrimaryAction('food'), 'meal-prep');
  assert.equal(communityPostPrimaryAction('update'), 'post-detail');
  assert.equal(communityPostCommentAction, 'post-comments');
});
