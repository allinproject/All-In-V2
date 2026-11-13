import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ONBOARDING_ANSWERS,
  V2_ONBOARDING_FOCUS_OPTIONS,
  createOnboardingSaveGuard,
  firstIncompleteOnboardingStep,
  isOnboardingAnswerComplete,
  matchesOnboardingRetryScope,
  onboardingPreferenceWrite,
  v2OnboardingScreenKey,
  type OnboardingAnswers,
} from './onboardingFlow.ts';

test('onboarding resumes at the first step not completed or skipped', () => {
  assert.equal(firstIncompleteOnboardingStep([], []), 'focus');
  assert.equal(firstIncompleteOnboardingStep(['focus', 'training_pattern'], []), 'availability');
  assert.equal(firstIncompleteOnboardingStep(['focus'], ['training_pattern', 'availability']), 'coach');
  assert.equal(firstIncompleteOnboardingStep(
    ['focus', 'training_pattern', 'coach', 'food_safety'],
    ['availability', 'proactivity'],
  ), null);
});

test('empty optional answers remain unknown until the user chooses or skips', () => {
  const answers = { ...EMPTY_ONBOARDING_ANSWERS };
  assert.equal(isOnboardingAnswerComplete('focus', answers), false);
  assert.equal(isOnboardingAnswerComplete('training_pattern', answers), false);
  assert.equal(isOnboardingAnswerComplete('availability', answers), false);
  assert.equal(isOnboardingAnswerComplete('coach', answers), false);
  assert.equal(isOnboardingAnswerComplete('food_safety', answers), false);
  assert.equal(isOnboardingAnswerComplete('proactivity', answers), false);
});

test('goal options describe desired outcomes, not current sports', () => {
  const values = V2_ONBOARDING_FOCUS_OPTIONS.map(option => option.value);
  assert.equal(new Set(values).size, values.length);
  assert.deepEqual(values, [
    'general_fitness', 'get_stronger', 'build_endurance', 'weight_loss',
    'weight_gain', 'prepare_event', 'be_consistent', 'nutrition',
  ]);
  assert.ok(!values.includes('running'));
});

test('V1-derived six distinct questions map to existing V2 Profile sections', () => {
  const answers: OnboardingAnswers = {
    ...EMPTY_ONBOARDING_ANSWERS,
    primaryFocus: 'prepare_event',
    eventGoal: '50-mile trail race',
    currentSports: ['running', 'strength', 'running'],
    trainingFrequency: '5_plus',
    trainingVolume: '40 miles',
    availableDays: ['monday', 'wednesday'],
    preferredTime: 'evening',
    sessionLength: '60_90',
    scheduleNotes: 'Shift work',
    trainingAccess: 'gym',
    constraintNotes: 'No pool',
    foodSafety: 'allergies_or_sensitivities',
    foodSafetyNotes: 'Peanuts',
    foodPreferences: 'No yogurt',
    fuelingNotes: 'Gels on long runs',
    mealPrep: 'yes',
    coachDetail: 'detailed',
    coachTone: 'direct',
    proactivity: 'proactive',
  };
  assert.deepEqual(onboardingPreferenceWrite('focus', answers), {
    section: 'training_preferences',
    patch: { primary_focus: 'prepare_event', event_goal: '50-mile trail race' },
  });
  assert.deepEqual(onboardingPreferenceWrite('training_pattern', answers), {
    section: 'training_preferences',
    patch: { current_sports: ['running', 'strength'], training_frequency: '5_plus', weekly_volume: '40 miles' },
  });
  assert.deepEqual(onboardingPreferenceWrite('availability', answers), {
    section: 'training_preferences',
    patch: {
      available_days: ['monday', 'wednesday'], preferred_time: 'evening',
      session_length: '60_90', schedule_notes: 'Shift work',
    },
  });
  assert.deepEqual(onboardingPreferenceWrite('coach', answers), {
    section: 'training_preferences',
    patch: { training_access: 'gym', constraint_notes: 'No pool' },
  });
  assert.deepEqual(onboardingPreferenceWrite('food_safety', answers), {
    section: 'nutrition_preferences',
    patch: {
      food_safety: { selection: 'allergies_or_sensitivities', notes: 'Peanuts' },
      food_preferences: 'No yogurt', fueling_notes: 'Gels on long runs', meal_prep: true,
    },
  });
  assert.deepEqual(onboardingPreferenceWrite('proactivity', answers), {
    section: 'coach_preferences',
    patch: { guidance_style: 'proactive', detail_level: 'detailed', tone: 'direct', proactive_suggestions: true },
  });
});

test('food-safety explicit none is not confused with unknown or an allergy', () => {
  const answers: OnboardingAnswers = {
    ...EMPTY_ONBOARDING_ANSWERS,
    foodSafety: 'none',
    foodSafetyNotes: '   ',
  };
  assert.equal(isOnboardingAnswerComplete('food_safety', answers), true);
  assert.deepEqual(onboardingPreferenceWrite('food_safety', answers), {
    section: 'nutrition_preferences',
    patch: {
      food_safety: { selection: 'none', notes: null },
      food_preferences: null, fueling_notes: null, meal_prep: null,
    },
  });
});

test('onboarding retry preserves action IDs only for the identical owner, step, action, and versions', () => {
  const original = {
    ownerId: 'user-a',
    step: 'focus' as const,
    action: 'complete' as const,
    settingsVersion: 2,
    progressVersion: 3,
  };
  assert.equal(matchesOnboardingRetryScope(null, original), false);
  assert.equal(matchesOnboardingRetryScope(original, { ...original }), true);
  assert.equal(matchesOnboardingRetryScope(original, { ...original, ownerId: 'user-b' }), false);
  assert.equal(matchesOnboardingRetryScope(original, { ...original, step: 'coach' }), false);
  assert.equal(matchesOnboardingRetryScope(original, { ...original, action: 'skip' }), false);
  assert.equal(matchesOnboardingRetryScope(original, { ...original, settingsVersion: 3 }), false);
  assert.equal(matchesOnboardingRetryScope(original, { ...original, progressVersion: 4 }), false);
});

test('onboarding save guard rejects rapid complete/skip attempts until the current save settles', () => {
  const guard = createOnboardingSaveGuard();
  assert.equal(guard.isBusy(), false);
  assert.equal(guard.tryEnter(), true);
  assert.equal(guard.isBusy(), true);
  assert.equal(guard.tryEnter(), false);
  assert.equal(guard.tryEnter(), false);
  guard.leave();
  assert.equal(guard.isBusy(), false);
  assert.equal(guard.tryEnter(), true);
  guard.leave();
  assert.equal(guard.tryEnter(), true);
});

test('onboarding drafts are isolated by both account and authenticated session', () => {
  const first = v2OnboardingScreenKey('athlete-a', 1);
  assert.equal(first, v2OnboardingScreenKey('athlete-a', 1));
  assert.notEqual(first, v2OnboardingScreenKey('athlete-b', 1));
  assert.notEqual(first, v2OnboardingScreenKey('athlete-a', 2));
  assert.notEqual(first, v2OnboardingScreenKey(null, 1));
});
