import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V2_ACTIVITY_SPORTS, activityEntryOptions, machinePhotoSportChoices,
  prepareMachinePhotoDraft,
} from './activityEntryContract.ts';

test('walking and every canonical sport have both entry paths', () => {
  assert.ok(V2_ACTIVITY_SPORTS.includes('walking'));
  for (const sport of V2_ACTIVITY_SPORTS) {
    assert.deepEqual(activityEntryOptions(sport), ['start_activity', 'manual_entry']);
  }
});

test('treadmill cannot silently choose running instead of walking', () => {
  assert.deepEqual(machinePhotoSportChoices('treadmill'), ['walking', 'running']);
  assert.deepEqual(machinePhotoSportChoices('rowing_machine'), ['rowing']);
  assert.deepEqual(machinePhotoSportChoices('stair_stepper'), ['stair']);
  assert.deepEqual(machinePhotoSportChoices('elliptical'), ['elliptical']);
});

test('machine photo readings are always unreviewed drafts, not completed workouts', () => {
  const draft = prepareMachinePhotoDraft('elliptical', [
    { metric: 'duration_seconds', value: 1800, displayUnit: 'seconds', confidence: 'high' },
    { metric: 'distance_meters', value: -5, displayUnit: 'm', confidence: 'uncertain' },
    { metric: 'calories_kcal', value: 300, displayUnit: 'kcal', confidence: 'unreadable' },
  ]);
  assert.equal(draft.reviewed, false);
  assert.equal(draft.source, 'machine_display_photo');
  assert.deepEqual(draft.readings.map(item => item.value), [1800, null, null]);
  assert.equal(draft.capturedAt, null);
});

test('duplicates and invalid non-finite photo readings cannot silently become facts', () => {
  const draft = prepareMachinePhotoDraft('stair_stepper', [
    { metric: 'steps', value: Number.NaN, displayUnit: null, confidence: 'uncertain' },
    { metric: 'steps', value: 1000, displayUnit: 'steps', confidence: 'high' },
    { metric: 'floors', value: Infinity, displayUnit: 'floors', confidence: 'high' },
  ]);
  assert.deepEqual(draft.readings.map(x => x.value), [null, null]);
});
