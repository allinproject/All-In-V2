import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ONBOARDING_ANSWERS,
  firstIncompleteOnboardingStep,
  isOnboardingAnswerComplete,
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
