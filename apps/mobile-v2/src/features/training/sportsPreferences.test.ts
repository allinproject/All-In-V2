import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPORTS_ACTIVITY_OPTIONS, SPORTS_FOCUS_OPTIONS, NOT_TRAINING_YET,
  parseSportsPreferences, chooseSportsFocus, toggleActiveSport,
  setStartingFromZero, sportsPreferencesPatch,
} from './sportsPreferences.ts';

test('Training Focus preserves canonical V2 onboarding focus including noncompetitive goals', () => {
  assert.ok(SPORTS_FOCUS_OPTIONS.some(option => option.value === 'general_fitness'));
  assert.ok(SPORTS_FOCUS_OPTIONS.some(option => option.value === 'nutrition_habits'));
  const initial = { primaryFocus: '', currentSports: ['running', 'strength'] };
  const focused = chooseSportsFocus(initial, 'running');
  assert.deepEqual(focused.currentSports, initial.currentSports);
  assert.equal(chooseSportsFocus(focused, 'running').primaryFocus, '');
  assert.equal(chooseSportsFocus(focused, '').primaryFocus, '');
  assert.throws(() => chooseSportsFocus(initial, 'racehub'), /Unsupported/);
});

test('active activities reuse original onboarding values without Other Interests', () => {
  const labels = SPORTS_ACTIVITY_OPTIONS.map(x => x.value);
  assert.ok(labels.includes('running') && labels.includes('elliptical') && labels.includes('stair_stepper'));
  assert.ok(!labels.includes('racehub') && !labels.includes('meal_prep'));
  const initial = { primaryFocus: 'strength', currentSports: ['running'] };
  const added = toggleActiveSport(initial, 'swimming');
  assert.deepEqual(added.currentSports, ['running', 'swimming']);
  assert.deepEqual(toggleActiveSport(added, 'running').currentSports, ['swimming']);
  assert.equal(added.primaryFocus, 'strength');
  assert.throws(() => toggleActiveSport(initial, 'equipment'), /Unsupported/);
});

test('newcomer preference is exclusive and switching to a sport removes it', () => {
  const initial = { primaryFocus: '', currentSports: ['running'] };
  const newcomer = setStartingFromZero(initial);
  assert.deepEqual(newcomer.currentSports, [NOT_TRAINING_YET]);
  assert.deepEqual(toggleActiveSport(newcomer, 'walking').currentSports, ['walking']);
  assert.deepEqual(setStartingFromZero(newcomer).currentSports, []);
});

test('settings patch only modifies canonical training_focus and current_sports fields', () => {
  assert.deepEqual(sportsPreferencesPatch({ primaryFocus: 'running', currentSports: ['running', 'strength'] }), {
    primary_focus: 'running', current_sports: ['running', 'strength'],
  });
  assert.deepEqual(sportsPreferencesPatch({ primaryFocus: '', currentSports: [] }), {
    primary_focus: null, current_sports: [],
  });
  assert.throws(() => sportsPreferencesPatch({ primaryFocus: '', currentSports: ['running', NOT_TRAINING_YET] }), /cannot be combined/);
  assert.throws(() => sportsPreferencesPatch({ primaryFocus: 'unknown', currentSports: [] }), /Unsupported/);
});

test('read sanitizes unknown values without inventing sport selections', () => {
  assert.deepEqual(parseSportsPreferences(null), { primaryFocus: '', currentSports: [] });
  assert.deepEqual(parseSportsPreferences({ primary_focus: 'cycling', current_sports: ['cycling', 'cycling', 'racehub'] }), {
    primaryFocus: 'cycling', currentSports: ['cycling'],
  });
  assert.deepEqual(parseSportsPreferences({ primary_focus: 'walking_hiking_rucking', current_sports: [NOT_TRAINING_YET] }), {
    primaryFocus: 'walking_hiking_rucking', currentSports: [NOT_TRAINING_YET],
  });
});
