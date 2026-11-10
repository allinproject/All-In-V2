import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ONBOARDING_ANSWERS,
  V2_ONBOARDING_FOCUS_OPTIONS,
  firstIncompleteOnboardingStep,
  isOnboardingAnswerComplete,
  matchesOnboardingRetryScope,
  onboardingPreferenceWrite,
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

test('initial focus options cover sports and non-race lifestyle starting points', () => {
  const values = V2_ONBOARDING_FOCUS_OPTIONS.map(option => option.value);
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.includes('general_fitness'));
  assert.ok(values.includes('nutrition_habits'));
  assert.ok(values.includes('body_composition'));
  assert.ok(values.includes('general_wellbeing'));
  assert.ok(values.includes('running'));
});

test('explicit onboarding answers map to the owning versioned profile settings sections', () => {
  const answers: OnboardingAnswers = {
    primaryFocus: 'run',
    currentSports: ['run', 'strength', 'run'],
    availableDays: ['monday', 'wednesday'],
    coachGuidance: 'balanced',
    foodSafety: 'allergies',
    foodSafetyNotes: 'Peanuts',
    proactivity: 'critical_only',
  };

  assert.deepEqual(onboardingPreferenceWrite('focus', answers), {
    section: 'training_preferences',
    patch: { primary_focus: 'run' },
  });
  assert.deepEqual(onboardingPreferenceWrite('training_pattern', answers), {
    section: 'training_preferences',
    patch: { current_sports: ['run', 'strength'] },
  });
  assert.deepEqual(onboardingPreferenceWrite('availability', answers), {
    section: 'training_preferences',
    patch: { available_days: ['monday', 'wednesday'] },
  });
  assert.deepEqual(onboardingPreferenceWrite('coach', answers), {
    section: 'coach_preferences',
    patch: { guidance_style: 'balanced' },
  });
  assert.deepEqual(onboardingPreferenceWrite('food_safety', answers), {
    section: 'nutrition_preferences',
    patch: { food_safety: { selection: 'allergies', notes: 'Peanuts' } },
  });
  assert.deepEqual(onboardingPreferenceWrite('proactivity', answers), {
    section: 'notification_preferences',
    patch: { proactivity_level: 'critical_only' },
  });
});

test('food-safety notes are optional and whitespace is normalized', () => {
  const answers: OnboardingAnswers = {
    ...EMPTY_ONBOARDING_ANSWERS,
    foodSafety: 'none',
    foodSafetyNotes: '   ',
  };
  assert.equal(isOnboardingAnswerComplete('food_safety', answers), true);
  assert.deepEqual(onboardingPreferenceWrite('food_safety', answers), {
    section: 'nutrition_preferences',
    patch: { food_safety: { selection: 'none', notes: null } },
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
