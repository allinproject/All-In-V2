import { V2_ONBOARDING_FOCUS_OPTIONS } from '../../auth/onboardingFlow.ts';

/** Reuse the canonical V2 onboarding training keys; no new settings owner. */
export const SPORTS_ACTIVITY_OPTIONS = [
  { value: 'running', label: 'Running' },
  { value: 'walking', label: 'Walking' },
  { value: 'hiking_rucking', label: 'Hiking / Rucking' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'strength', label: 'Strength' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'elliptical', label: 'Elliptical' },
  { value: 'stair_stepper', label: 'Stair-stepper' },
  { value: 'mobility_yoga', label: 'Mobility / Yoga' },
] as const;

/** Preserve all existing V2 onboarding focus choices, including noncompetitive goals. */
export const SPORTS_FOCUS_OPTIONS = V2_ONBOARDING_FOCUS_OPTIONS;
export const NOT_TRAINING_YET = 'not_currently_training';

export type SportsPreferences = {
  primaryFocus: string;
  currentSports: string[];
};

const SPORTS = new Set<string>(SPORTS_ACTIVITY_OPTIONS.map(option => option.value));
const FOCUS = new Set<string>(SPORTS_FOCUS_OPTIONS.map(option => option.value));

export function parseSportsPreferences(raw: unknown): SportsPreferences {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const focus = typeof record.primary_focus === 'string' && FOCUS.has(record.primary_focus)
    ? record.primary_focus : '';
  const sports = Array.isArray(record.current_sports) ? record.current_sports : [];
  const cleanSports = [...new Set(sports.filter((value): value is string => typeof value === 'string' && SPORTS.has(value)))];
  // A newcomer choice is exclusive and not an active sport.
  const notTraining = sports.includes(NOT_TRAINING_YET) && cleanSports.length === 0;
  return { primaryFocus: focus, currentSports: notTraining ? [NOT_TRAINING_YET] : cleanSports };
}

export function chooseSportsFocus(state: SportsPreferences, value: string): SportsPreferences {
  if (value && !FOCUS.has(value)) throw new Error('Unsupported training focus.');
  return { ...state, primaryFocus: state.primaryFocus === value ? '' : value };
}

export function toggleActiveSport(state: SportsPreferences, value: string): SportsPreferences {
  if (!SPORTS.has(value)) throw new Error('Unsupported training activity.');
  const active = state.currentSports.filter(sport => sport !== NOT_TRAINING_YET);
  return {
    ...state,
    currentSports: active.includes(value) ? active.filter(sport => sport !== value) : [...active, value],
  };
}

export function setStartingFromZero(state: SportsPreferences): SportsPreferences {
  return {
    ...state,
    currentSports: state.currentSports.includes(NOT_TRAINING_YET) ? [] : [NOT_TRAINING_YET],
  };
}

/** Both keys are edited in one versioned settings patch to avoid partial saves. */
export function sportsPreferencesPatch(state: SportsPreferences) {
  if (state.primaryFocus && !FOCUS.has(state.primaryFocus)) throw new Error('Unsupported training focus.');
  if (state.currentSports.some(sport => sport !== NOT_TRAINING_YET && !SPORTS.has(sport))) throw new Error('Unsupported training activity.');
  const currentSports = [...new Set(state.currentSports)];
  if (currentSports.includes(NOT_TRAINING_YET) && currentSports.length > 1) throw new Error('Starting from zero cannot be combined with active activities.');
  return { primary_focus: state.primaryFocus || null, current_sports: currentSports };
}
