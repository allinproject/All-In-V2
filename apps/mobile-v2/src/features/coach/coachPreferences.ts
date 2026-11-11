/**
 * V2 Coach interaction preferences.
 * Stored in the existing versioned v2_profile_settings.coach_preferences section.
 * Coach behavior consumers still need to be integrated and validated separately.
 */
export const GUIDANCE_OPTIONS = [
  { value: 'only_when_asked', label: 'When I ask', description: 'Let me lead.' },
  { value: 'balanced', label: 'Balanced', description: 'Helpful suggestions without constant interruptions.' },
  { value: 'proactive', label: 'Proactive', description: 'More relevant guidance when useful.' },
] as const;
export const DETAIL_OPTIONS = [
  { value: 'brief', label: 'Brief', description: 'Get to the point.' },
  { value: 'adaptive', label: 'Adaptive', description: 'Match the situation.' },
  { value: 'detailed', label: 'Detailed', description: 'Explain the reasoning.' },
] as const;
export const PLAN_CHANGE_OPTIONS = [
  { value: 'ask_first', label: 'Ask first', description: 'Review proposed changes before applying.' },
  { value: 'suggestions_only', label: 'Suggestions only', description: 'I will make any changes myself.' },
] as const;
export const TONE_OPTIONS = [
  { value: 'supportive', label: 'Supportive' },
  { value: 'direct', label: 'Direct and straightforward' },
  { value: 'motivational', label: 'Motivational' },
] as const;

export type CoachPreferences = {
  guidance_style: typeof GUIDANCE_OPTIONS[number]['value'] | null;
  explanation_detail: typeof DETAIL_OPTIONS[number]['value'] | null;
  plan_change_mode: typeof PLAN_CHANGE_OPTIONS[number]['value'] | null;
  coaching_tone: typeof TONE_OPTIONS[number]['value'] | null;
};
export const EMPTY_COACH_PREFERENCES: CoachPreferences = {
  guidance_style: null,
  explanation_detail: null,
  plan_change_mode: null,
  coaching_tone: null,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function allowedValue<T extends string>(value: unknown, options: readonly { value: T }[]): T | null {
  return typeof value === 'string' && options.some(option => option.value === value)
    ? value as T : null;
}
export function parseCoachPreferences(value: unknown): CoachPreferences {
  const source = record(value);
  return {
    guidance_style: allowedValue(source.guidance_style, GUIDANCE_OPTIONS),
    explanation_detail: allowedValue(source.explanation_detail, DETAIL_OPTIONS),
    plan_change_mode: allowedValue(source.plan_change_mode, PLAN_CHANGE_OPTIONS),
    coaching_tone: allowedValue(source.coaching_tone, TONE_OPTIONS),
  };
}
export function coachPreferencesPatch(value: CoachPreferences): CoachPreferences {
  const clean = parseCoachPreferences(value);
  if (Object.keys(clean).some(key => value[key as keyof CoachPreferences] !== clean[key as keyof CoachPreferences])) {
    throw new Error('Unsupported Coach preference.');
  }
  return clean;
}
/** Plan edits are always opt-in; style cannot authorize automatic plan mutation. */
export function mayAutoApplyTrainingPlanChange(_preferences: CoachPreferences): false {
  return false;
}
