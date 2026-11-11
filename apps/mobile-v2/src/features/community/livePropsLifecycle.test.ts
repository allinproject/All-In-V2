import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLiveProps, finishLiveProps, isLivePropsVisible, propsReactionKey, mayQueueLiveCheer } from './livePropsLifecycle.ts';

const started = {
  ownerId: 'athlete-a', workoutId: 'workout-1', postId: 'post-1',
  optedIn: true, shareToCommunity: true, shareToEventHub: true, eventId: 'event-1',
};
function live() {
  const value = beginLiveProps(started);
  assert.ok(value);
  return value;
}

test('never announces a workout without opt-in or selected sharing audiences', () => {
  assert.equal(beginLiveProps({ ...started, optedIn: false }), null);
  assert.equal(beginLiveProps({ ...started, shareToCommunity: false, shareToEventHub: false }), null);
  assert.throws(() => beginLiveProps({ ...started, eventId: null }), /event ID/);
  assert.throws(() => beginLiveProps({ ...started, postId: ' ' }), /identity/);
});
test('Community and EventHub share ONE canonical live post and EventHub cannot claim another event', () => {
  const a = live();
  assert.deepEqual(a.audiences, ['community', 'eventhub']);
  assert.equal(isLivePropsVisible(a, 'community', null), true);
  assert.equal(isLivePropsVisible(a, 'eventhub', 'event-1'), true);
  assert.equal(isLivePropsVisible(a, 'eventhub', 'event-2'), false);
  assert.equal(isLivePropsVisible(a, 'eventhub', null), false);
});
test('final shared activity preserves post identity; private or discarded activity withdraws announcement', () => {
  const a = live();
  const shared = finishLiveProps(a, 'shared');
  assert.equal(shared.postId, a.postId);
  assert.equal(shared.workoutId, a.workoutId);
  assert.equal(shared.phase, 'completed');
  assert.equal(shared.sharedFinalActivity, true);
  for (const outcome of ['private', 'discarded'] as const) {
    const withdrawn = finishLiveProps(a, outcome);
    assert.equal(withdrawn.postId, a.postId);
    assert.equal(withdrawn.phase, 'withdrawn');
    assert.equal(isLivePropsVisible(withdrawn, 'community', null), false);
    assert.equal(isLivePropsVisible(withdrawn, 'eventhub', 'event-1'), false);
    assert.throws(() => propsReactionKey(withdrawn, 'athlete-b'), /not shared/);
  }
  assert.throws(() => finishLiveProps(shared, 'shared'), /Only a live/);
});
test('one canonical viewer/post reaction key covers live, complete, Community and EventHub', () => {
  const a = live();
  const key = propsReactionKey(a, 'athlete-b');
  assert.deepEqual(key, propsReactionKey(finishLiveProps(a, 'shared'), 'athlete-b'));
  assert.deepEqual(key, { postId: 'post-1', viewerId: 'athlete-b' });
  assert.notDeepEqual(key, propsReactionKey(a, 'athlete-c'));
  assert.throws(() => propsReactionKey(a, 'athlete-a'), /themselves/);
  assert.throws(() => propsReactionKey(a, ' '), /Viewer/);
});
test('cheer requires an inserted first reaction, live state and audio opt-in', () => {
  const a = live();
  assert.equal(mayQueueLiveCheer(a, true, true), true);
  assert.equal(mayQueueLiveCheer(a, false, true), false);
  assert.equal(mayQueueLiveCheer(a, true, false), false);
  assert.equal(mayQueueLiveCheer(finishLiveProps(a, 'shared'), true, true), false);
});
