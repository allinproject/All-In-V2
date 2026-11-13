/**
 * V1-derived health-first Q2 baseline contract.
 * No OS permission is requested here. Only an explicitly authorized, canonical
 * owner-bound history reader may supply data. Never use untrusted device payloads
 * or infer zero training from a missing/denied/partial Health permission.
 */
export type HealthOnboardingPlatform = 'ios' | 'android' | 'other';
export type HealthOnboardingProvider = 'apple_health' | 'health_connect';
export type HealthOnboardingStatus = 'not_offered' | 'reviewed' | 'skipped';

export function healthOnboardingProvider(platform: HealthOnboardingPlatform):
  HealthOnboardingProvider | null {
  if (platform === 'ios') return 'apple_health';
  if (platform === 'android') return 'health_connect';
  return null;
}

export function shouldOfferHealthBeforeTraining(args: {
  nextStep: string | null;
  disposition: HealthOnboardingStatus;
  provider: HealthOnboardingProvider | null;
  nativeAuthorizationAvailable: boolean;
}): boolean {
  return args.nextStep === 'training_pattern' &&
    args.disposition === 'not_offered' &&
    args.provider !== null &&
    args.nativeAuthorizationAvailable;
}

export type VerifiedOnboardingWorkout = {
  canonicalActivityId: string;
  ownerId: string;
  sport: string;
  completedAt: string;
  provider: HealthOnboardingProvider;
  provenance: 'authorized_device_import';
  quality: 'trusted' | 'partial' | 'unverified' | 'rejected';
};

/** Must come from a canonical owner-verified source, never direct unverified Health JSON. */
export type VerifiedHealthHistoryWindow = {
  expectedOwnerId: string;
  asOf: string;
  from: string;
  through: string;
  authorization: 'confirmed' | 'denied' | 'unknown';
  coverage: 'complete' | 'partial' | 'unknown';
  workouts: readonly VerifiedOnboardingWorkout[];
};

export type HealthTrainingBaseline = {
  workoutCount: number;
  activeDays: number;
  activities: string[];
  frequency: '1_2' | '3_4' | '5_plus';
};

const CANONICAL_SPORTS: Record<string, string> = {
  running: 'running', treadmill: 'running',
  walking: 'walking', hiking: 'hiking_rucking', rucking: 'hiking_rucking',
  cycling: 'cycling', indoor_cycling: 'cycling',
  strength: 'strength', swimming: 'swimming',
  pool_swim: 'swimming', open_water_swim: 'swimming',
  elliptical: 'elliptical', stair_stepper: 'stair_stepper',
  yoga: 'mobility_yoga', mobility: 'mobility_yoga',
};

const validTime = (s: string): number | null => {
  const time = Date.parse(s);
  return typeof s === 'string' && Number.isFinite(time) ? time : null;
};

export function deriveVerifiedHealthTrainingBaseline(
  window: VerifiedHealthHistoryWindow,
): HealthTrainingBaseline | null {
  const asOf = validTime(window.asOf);
  const from = validTime(window.from);
  const through = validTime(window.through);
  if (!window.expectedOwnerId || asOf === null || from === null || through === null ||
      from > through || through > asOf ||
      through - from < 26 * 86400000 || through - from > 29 * 86400000 ||
      window.authorization !== 'confirmed' || window.coverage !== 'complete' ||
      !Array.isArray(window.workouts) || window.workouts.length > 10000) return null;

  // Reject the whole window on any cross-owner, bad identity or untrusted record.
  // A record dropped from the count may otherwise make a false negative look authoritative.
  const ids = new Set<string>();
  const days = new Set<string>();
  const activities = new Set<string>();
  let workoutCount = 0;
  for (const workout of window.workouts) {
    const at = validTime(workout?.completedAt);
    if (!workout || !workout.canonicalActivityId ||
        workout.ownerId !== window.expectedOwnerId ||
        !['apple_health', 'health_connect'].includes(workout.provider) ||
        workout.provenance !== 'authorized_device_import' ||
        workout.quality !== 'trusted' ||
        at === null || at < from || at > through ||
        ids.has(workout.canonicalActivityId)) return null;
    ids.add(workout.canonicalActivityId);
    workoutCount++;
    // Canonical timestamp is ISO; avoid inferring user's local calendar timezone.
    days.add(new Date(at).toISOString().slice(0, 10));
    const mapped = CANONICAL_SPORTS[workout.sport];
    if (mapped) activities.add(mapped);
  }
  // V1: at least 3 sessions across 2 distinct active days, and at least one
  // confidently classified sport. No fabricated answer for unknown sports.
  if (workoutCount < 3 || days.size < 2 || activities.size === 0) return null;
  return {
    workoutCount,
    activeDays: days.size,
    activities: [...activities],
    frequency: days.size <= 8 ? '1_2' : days.size <= 16 ? '3_4' : '5_plus',
  };
}
