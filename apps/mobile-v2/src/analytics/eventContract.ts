/**
 * V2 analytics contract — analytics event names only, never athlete content.
 *
 * Transport is deliberately not connected until the PostHog mobile SDK,
 * consent policy and real build are validated (ALL-224 / ALL-261).
 *
 * Only owning workflows may report completed outcomes. Do not infer
 * completed events from an attempted tap or navigation.
 */
export const V2_ANALYTICS_EVENTS = {
  signupStarted: 'signup_started',
  signupCompleted: 'signup_completed',
  legalConsentCompleted: 'legal_consent_completed',
  onboardingCompleted: 'onboarding_completed',
  trainingPlanCreated: 'training_plan_created',
  workoutCompleted: 'workout_completed',
  coachSuggestionAccepted: 'coach_suggestion_accepted',
  coachSuggestionDismissed: 'coach_suggestion_dismissed',
  recipeCooked: 'recipe_cooked',
  trialStarted: 'trial_started',
  subscriptionConverted: 'subscription_converted',
  subscriptionCanceled: 'subscription_canceled',
  referralEarned: 'referral_earned',
} as const;

export type V2AnalyticsEvent = typeof V2_ANALYTICS_EVENTS[keyof typeof V2_ANALYTICS_EVENTS];

/** Server-authoritative outcome signals use zero custom event properties. */
export function prepareV2AnalyticsEvent(event: V2AnalyticsEvent): {
  event: V2AnalyticsEvent;
  properties: Record<string, never>;
} {
  if (!(Object.values(V2_ANALYTICS_EVENTS) as string[]).includes(event)) {
    throw new Error('Unsupported V2 analytics event.');
  }
  return { event, properties: {} };
}
