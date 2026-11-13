import { REQUIRED_V2_ONBOARDING_STEPS } from './accessGateClient.ts';
import type { Json } from '../types/database.types';

export type OnboardingStep = typeof REQUIRED_V2_ONBOARDING_STEPS[number];

export type OnboardingFocusOption = {
  value: string;
  label: string;
};

// This is the athlete's initial orientation, not their canonical Goal list.
// Users can pursue several goals concurrently after onboarding.
export const V2_ONBOARDING_FOCUS_OPTIONS: readonly OnboardingFocusOption[] = [
  { value: 'general_fitness', label: 'Improve overall fitness' },
  { value: 'get_stronger', label: 'Get stronger' },
  { value: 'build_endurance', label: 'Build endurance' },
  { value: 'weight_loss', label: 'Lose weight' },
  { value: 'weight_gain', label: 'Gain weight' },
  { value: 'prepare_event', label: 'Prepare for a race / event' },
  { value: 'be_consistent', label: 'Build consistency' },
  { value: 'nutrition', label: 'Improve nutrition' },
] as const;
export type SettingsSection =
  | 'training_preferences'
  | 'coach_preferences'
  | 'nutrition_preferences'
  | 'notification_preferences';

export type OnboardingAnswers = {
  primaryFocus: string;
  eventGoal: string;
  trainingFrequency: string;
  trainingVolume: string;
  preferredTime: string;
  sessionLength: string;
  scheduleNotes: string;
  trainingAccess: string;
  constraintNotes: string;
  foodPreferences: string;
  fuelingNotes: string;
  mealPrep: string;
  coachDetail: string;
  coachTone: string;
  currentSports: string[];
  availableDays: string[];
  coachGuidance: string;
  foodSafety: string;
  foodSafetyNotes: string;
  proactivity: string;
};

export type OnboardingActionScope = {
  ownerId: string;
  step: OnboardingStep;
  action: 'complete' | 'skip';
  settingsVersion: number;
  progressVersion: number;
};

/** An idempotent retry must use precisely the same operation parameters. */
export function matchesOnboardingRetryScope(
  pending: OnboardingActionScope | null,
  current: OnboardingActionScope,
): boolean {
  return pending !== null
    && pending.ownerId === current.ownerId
    && pending.step === current.step
    && pending.action === current.action
    && pending.settingsVersion === current.settingsVersion
    && pending.progressVersion === current.progressVersion;
}

/**
 * Claim a save synchronously, before React can render its busy/disabled state.
 * Prevents near-simultaneous Complete and Skip presses from racing two writes.
 */
export function createOnboardingSaveGuard() {
  let inFlight = false;
  return {
    isBusy(): boolean {
      return inFlight;
    },
    tryEnter(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    leave(): void {
      inFlight = false;
    },
  };
}

/** Remount onboarding state when the account or authenticated session changes. */
export function v2OnboardingScreenKey(ownerId: string | null, sessionGeneration: number): string {
  return JSON.stringify([ownerId, sessionGeneration]);
}

export type OnboardingPreferenceWrite = {
  section: SettingsSection;
  patch: Json;
};

export const EMPTY_ONBOARDING_ANSWERS: OnboardingAnswers = {
  primaryFocus: '',
  eventGoal: '',
  trainingFrequency: '',
  trainingVolume: '',
  preferredTime: '',
  sessionLength: '',
  scheduleNotes: '',
  trainingAccess: '',
  constraintNotes: '',
  foodPreferences: '',
  fuelingNotes: '',
  mealPrep: '',
  coachDetail: 'normal',
  coachTone: 'neutral',
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
      return answers.currentSports.length > 0 || answers.trainingFrequency.trim().length > 0 || answers.trainingVolume.trim().length > 0;
    case 'availability':
      return answers.availableDays.length > 0 || answers.preferredTime.trim().length > 0 || answers.sessionLength.trim().length > 0 || answers.scheduleNotes.trim().length > 0;
    case 'coach':
      return answers.trainingAccess.trim().length > 0 || answers.constraintNotes.trim().length > 0;
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
        patch: { primary_focus: answers.primaryFocus.trim(), event_goal: answers.primaryFocus === 'prepare_event' ? answers.eventGoal.trim() || null : null },
      };
    case 'training_pattern':
      return {
        section: 'training_preferences',
        patch: { current_sports: [...new Set(answers.currentSports)], training_frequency: answers.trainingFrequency || null, weekly_volume: answers.trainingVolume.trim() || null },
      };
    case 'availability':
      return {
        section: 'training_preferences',
        patch: { available_days: [...new Set(answers.availableDays)], preferred_time: answers.preferredTime || null, session_length: answers.sessionLength || null, schedule_notes: answers.scheduleNotes.trim() || null },
      };
    case 'coach':
      return {
        section: 'training_preferences',
        patch: { training_access: answers.trainingAccess || null, constraint_notes: answers.constraintNotes.trim() || null },
      };
    case 'food_safety':
      return {
        section: 'nutrition_preferences',
        patch: {
          food_safety: {
            selection: answers.foodSafety,
            notes: answers.foodSafetyNotes.trim() || null,
          },
          food_preferences: answers.foodPreferences.trim() || null,
          fueling_notes: answers.fuelingNotes.trim() || null,
          meal_prep: answers.mealPrep === 'yes' ? true : answers.mealPrep === 'no' ? false : null,
        },
      };
    case 'proactivity':
      return {
        section: 'coach_preferences',
        patch: { guidance_style: answers.proactivity, detail_level: answers.coachDetail, tone: answers.coachTone, proactive_suggestions: answers.proactivity === 'proactive' },
      };
  }
}
