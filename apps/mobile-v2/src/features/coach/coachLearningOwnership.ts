/**
 * The "What Coach Knows" surface is exclusively for durable learning without
 * another canonical app owner. Never shadow real profile/domain settings.
 *
 * This is a pure contract, not a persistence implementation.
 */
export const CANONICAL_LEARNING_OWNERS = {
  kitchen_equipment: 'kitchen',
  kitchen_capacity: 'kitchen',
  food_allergy: 'nutrition',
  food_restriction: 'nutrition',
  sports_activities: 'training',
  training_focus: 'training',
  coaching_tone: 'coach_preferences',
  explanation_detail: 'coach_preferences',
  guidance_style: 'coach_preferences',
  training_plan_changes: 'coach_preferences',
  notification_frequency: 'notifications',
} as const;

export type LearningTopic = keyof typeof CANONICAL_LEARNING_OWNERS
  | 'workout_feedback'
  | 'recovery_feedback'
  | 'training_pattern'
  | 'preference_without_owner'
  | 'recommendation_feedback';

export type LearningReviewState = 'proposed' | 'confirmed' | 'dismissed' | 'superseded';
export type LearningSource = 'user_explicit' | 'canonical_app_data' | 'coach_inference';

export type CoachLearningRecord = {
  id: string;
  topic: LearningTopic;
  state: LearningReviewState;
  source: LearningSource;
  summary: string;
  evidence: string | null;
  updatedAt: string | null;
};

export type LearningDestination =
  | { kind: 'canonical'; owner: typeof CANONICAL_LEARNING_OWNERS[keyof typeof CANONICAL_LEARNING_OWNERS] }
  | { kind: 'coach_learning' };

export function learningDestination(topic: LearningTopic): LearningDestination {
  if (Object.prototype.hasOwnProperty.call(CANONICAL_LEARNING_OWNERS, topic)) {
    return {
      kind: 'canonical',
      owner: CANONICAL_LEARNING_OWNERS[topic as keyof typeof CANONICAL_LEARNING_OWNERS],
    };
  }
  return { kind: 'coach_learning' };
}

/** A proposed inference is NEVER promoted to confirmed merely by showing it. */
export function isReviewableLearning(record: CoachLearningRecord): boolean {
  return learningDestination(record.topic).kind === 'coach_learning'
    && record.state === 'proposed';
}
export function isConfirmedLearning(record: CoachLearningRecord): boolean {
  return learningDestination(record.topic).kind === 'coach_learning'
    && record.state === 'confirmed';
}

/** Reset in What Coach Knows affects Coach-owned learning only, never canonical records. */
export function eligibleForCoachLearningReset(records: readonly CoachLearningRecord[]): string[] {
  return records.filter(record =>
    learningDestination(record.topic).kind === 'coach_learning'
    && (record.state === 'proposed' || record.state === 'confirmed')
  ).map(record => record.id);
}
