import { REQUIRED_V2_ONBOARDING_STEPS } from './accessGateClient';
import type { Json } from '../types/database.types';

export type OnboardingStep = typeof REQUIRED_V2_ONBOARDING_STEPS[number];
export type SettingsSection =
  | 'training_preferences'
  | 'coach_preferences'
  | 'nutrition_preferences'
  | 'notification_preferences';

export type OnboardingAnswers = {
  primaryFocus: string;
  currentSports: string[];
  availableDays: string[];
  coachGuidance: string;
  foodSafety: string;
  foodSafetyNotes: string;
  proactivity: string;
};

export type OnboardingPreferenceWrite = {
  section: SettingsSection;
  patch: Json;
};

export const EMPTY_ONBOARDING_ANSWERS: OnboardingAnswers = {
  primaryFocus: '',
  currentSports: [],
  availableDays: [],
  coachGuidance: '',
  foodSafety: '',
  foodSafetyNotes: '',
  proactivity: '',
};

export function firstIncompleteOnboardingStep(
  completedSteps: readonly string[],
  skippedSteps: readonly string[],
): OnboardingStep | null {
  const satisfied = new Set([...completedSteps, ...skippedSteps]);
  return REQUIRED_V2_ONBOARDING_STEPS.find(step => !satisfied.has(step)) ?? null;
}

export function isOnboardingAnswerComplete(
  step: OnboardingStep,
  answers: OnboardingAnswers,
): boolean {
  switch (step) {
    case 'focus':
      return answers.primaryFocus.trim().length > 0;
    case 'training_pattern':
      return answers.currentSports.length > 0;
    case 'availability':
      return answers.availableDays.length > 0;
    case 'coach':
      return answers.coachGuidance.trim().length > 0;
    case 'food_safety':
      return answers.foodSafety.trim().length > 0;
    case 'proactivity':
      return answers.proactivity.trim().length > 0;
  }
}

export function onboardingPreferenceWrite(
  step: OnboardingStep,
  answers: OnboardingAnswers,
): OnboardingPreferenceWrite {
  switch (step) {
    case 'focus':
      return {
        section: 'training_preferences',
        patch: { primary_focus: answers.primaryFocus.trim() },
      };
    case 'training_pattern':
      return {
        section: 'training_preferences',
        patch: { current_sports: [...new Set(answers.currentSports)] },
      };
    case 'availability':
      return {
        section: 'training_preferences',
        patch: { available_days: [...new Set(answers.availableDays)] },
      };
    case 'coach':
      return {
        section: 'coach_preferences',
        patch: { guidance_style: answers.coachGuidance },
      };
    case 'food_safety':
      return {
        section: 'nutrition_preferences',
        patch: {
          food_safety: {
            selection: answers.foodSafety,
            notes: answers.foodSafetyNotes.trim() || null,
          },
        },
      };
    case 'proactivity':
      return {
        section: 'notification_preferences',
        patch: { proactivity_level: answers.proactivity },
      };
  }
}
