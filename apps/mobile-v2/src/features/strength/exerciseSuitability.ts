/**
 * ALL-258: read-only, evidence-led movement suitability evaluation.
 *
 * This is an invocation-time adapter over owner snapshots. It creates no
 * athlete, equipment, goal, restriction, Training-load or exercise database.
 * The caller must resolve data from ALL-239 Goals, ALL-251 Profile/location
 * inventory, ALL-232 Athlete History and ALL-246 Training before evaluating.
 *
 * No sets, reps, load, weekly dose or Training plan writes are produced here.
 */
import type {AthleteRestriction} from '../training/athleteHistoryContext.ts';
import {
  validateExerciseScienceProfile,
  type ExerciseGoal,
  type ExerciseScienceProfile,
  type ExerciseSport,
} from './exerciseScienceProfile.ts';

type ReadStatus = 'complete' | 'partial' | 'unknown';

export type ExerciseSuitabilityOwnerSnapshots = {
  goals: {
    owner: 'ALL-239';
    status: ReadStatus;
    active: readonly {
      goalId: string;
      role: 'primary' | 'secondary' | 'maintenance';
      sports: readonly ExerciseSport[];
      exerciseGoals: readonly ExerciseGoal[];
    }[];
  };
  location: {
    owner: 'ALL-251';
    status: ReadStatus;
    selectedLocationId: string | null;
    confirmedEquipmentIds: readonly string[];
  };
  restrictions: {
    owner: 'ALL-232';
    status: ReadStatus;
    active: readonly AthleteRestriction[];
  };
  strengthExperience: {
    /** The canonical lifting-history/onboarding adapter resolves this value. */
    owner: 'ALL-257';
    status: ReadStatus;
    skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'unknown';
  };
  trainingLoad: {
    owner: 'ALL-246';
    status: ReadStatus;
    /** Training owns this conflict calculation against its accepted plan. */
    nextSessionConflict: 'clear' | 'conflict' | 'unknown';
    conflictingMuscleGroupIds: readonly string[];
  };
};

export type ExerciseSuitabilityResult =
  | {
      status: 'recommended';
      movementId: string;
      variationId: string;
      displayName: string;
      variationDescription: string;
      requiredEquipmentIds: readonly string[];
      optionalEquipmentIds: readonly string[];
      matchedGoalIds: readonly string[];
      matchedSports: readonly ExerciseSport[];
      transfer: 'direct_sport_evidence' | 'general_adaptation_indirect_transfer';
      whyThisFits: readonly string[];
      muscleRoles: ExerciseScienceProfile['muscleGroups'];
      jointDemands: ExerciseScienceProfile['jointDemands'];
      cautionFlags: ExerciseScienceProfile['cautionFlags'];
      alternativeVariationIds: readonly string[];
      regressionVariationIds: readonly string[];
      progressionVariationIds: readonly string[];
      coachingCues: ExerciseScienceProfile['coachingCues'];
      sources: ExerciseScienceProfile['sources'];
      evidence: readonly {
        claimId: string;
        directness: string;
        evidenceTier: string;
        confidence: string;
        sourceIds: readonly string[];
        limitation: string;
      }[];
      limitations: readonly string[];
      noDoseOrPlanWrite: true;
    }
  | {
      status: 'blocked' | 'review_required' | 'not_supported';
      movementId: string;
      variationId: string;
      displayName: string;
      reasonCodes: readonly string[];
      explanation: string;
      noDoseOrPlanWrite: true;
    };

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function stop(
  profile: ExerciseScienceProfile,
  status: 'blocked' | 'review_required' | 'not_supported',
  reasonCode: string,
  explanation: string,
): ExerciseSuitabilityResult {
  return {
    status,
    movementId: profile?.movementId ?? '',
    variationId: profile?.variationId ?? '',
    displayName: profile?.displayName ?? '',
    reasonCodes: [reasonCode],
    explanation,
    noDoseOrPlanWrite: true,
  };
}

const SPORT_VALUES = ['running','cycling','swimming','triathlon','walking','hiking','rucking','rowing','strength_sport','general_fitness'] as const;
const GOAL_VALUES = ['maximal_strength','hypertrophy','power','muscular_endurance','balance','mobility','sport_performance','general_function'] as const;
const RESTRICTION_CATEGORIES = ['exercise','equipment','schedule','pain_or_return','preference'] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function ownerSnapshotIsValid(context: ExerciseSuitabilityOwnerSnapshots): boolean {
  if (!context || !context.location || !context.goals || !context.restrictions ||
      !context.strengthExperience || !context.trainingLoad) return false;
  if (!nonEmpty(context.location.selectedLocationId) ||
      !Array.isArray(context.location.confirmedEquipmentIds) ||
      !context.location.confirmedEquipmentIds.every(nonEmpty) ||
      new Set(context.location.confirmedEquipmentIds).size !== context.location.confirmedEquipmentIds.length) return false;
  if (!Array.isArray(context.goals.active) || context.goals.active.length === 0 ||
      !context.goals.active.every((goal) =>
        Boolean(goal) && nonEmpty(goal.goalId) &&
        ['primary','secondary','maintenance'].includes(goal.role) &&
        Array.isArray(goal.sports) && goal.sports.length > 0 &&
        goal.sports.every((sport) => (SPORT_VALUES as readonly string[]).includes(sport)) &&
        Array.isArray(goal.exerciseGoals) && goal.exerciseGoals.length > 0 &&
        goal.exerciseGoals.every((goalType) => (GOAL_VALUES as readonly string[]).includes(goalType))
      )) return false;
  if (!Array.isArray(context.restrictions.active) ||
      !context.restrictions.active.every((restriction) =>
        Boolean(restriction) &&
        ['active','inactive'].includes(restriction.status) &&
        (restriction.status !== 'active' ||
          (RESTRICTION_CATEGORIES as readonly string[]).includes(restriction.category) &&
          nonEmpty(restriction.subject))
      )) return false;
  if (!['beginner','intermediate','advanced','unknown'].includes(context.strengthExperience.skillLevel)) return false;
  if (!['clear','conflict','unknown'].includes(context.trainingLoad.nextSessionConflict) ||
      !Array.isArray(context.trainingLoad.conflictingMuscleGroupIds) ||
      !context.trainingLoad.conflictingMuscleGroupIds.every(nonEmpty)) return false;
  return true;
}

function ownerContextIsComplete(context: ExerciseSuitabilityOwnerSnapshots): boolean {
  return Boolean(
    context &&
    context.goals?.owner === 'ALL-239' && context.goals.status === 'complete' &&
    context.location?.owner === 'ALL-251' && context.location.status === 'complete' &&
    context.restrictions?.owner === 'ALL-232' && context.restrictions.status === 'complete' &&
    context.strengthExperience?.owner === 'ALL-257' && context.strengthExperience.status === 'complete' &&
    context.trainingLoad?.owner === 'ALL-246' && context.trainingLoad.status === 'complete' &&
    ownerSnapshotIsValid(context)
  );
}

function matchesGoalClaims(
  profile: ExerciseScienceProfile,
  goals: ExerciseSuitabilityOwnerSnapshots['goals']['active'],
): Array<{
  claim: ExerciseScienceProfile['claims'][number];
  goalIds: string[];
  sports: ExerciseSport[];
}> {
  const matches: Array<{
    claim: ExerciseScienceProfile['claims'][number];
    goalIds: string[];
    sports: ExerciseSport[];
  }> = [];

  for (const claim of profile.claims) {
    if (
      claim.directness === 'mechanistic_rationale' ||
      !Array.isArray(claim.targetSports) ||
      !Array.isArray(claim.targetGoals)
    ) continue;

    const goalIds: string[] = [];
    const sports = new Set<ExerciseSport>();
    for (const goal of goals) {
      if (!goal.goalId || goal.role === 'maintenance') continue;
      const goalMatches = goal.exerciseGoals.some((target) => claim.targetGoals.includes(target));
      if (!goalMatches) continue;

      const exactSportMatches = goal.sports.filter((sport) => claim.targetSports.includes(sport));
      const generalAdaptationMatches =
        claim.directness === 'general_training_adaptation' &&
        claim.targetSports.includes('general_fitness');
      if (exactSportMatches.length === 0 && !generalAdaptationMatches) continue;

      goalIds.push(goal.goalId);
      for (const sport of exactSportMatches) sports.add(sport);
      if (generalAdaptationMatches && exactSportMatches.length === 0) {
        for (const sport of goal.sports) sports.add(sport);
      }
    }
    if (goalIds.length > 0) matches.push({claim, goalIds, sports: [...sports]});
  }
  return matches;
}

function restrictionDecision(
  profile: ExerciseScienceProfile,
  restrictions: readonly AthleteRestriction[],
): {status: 'clear' | 'blocked' | 'review'; reason?: string} {
  const aliases = new Set([
    profile.movementId,
    profile.variationId,
    profile.displayName,
    profile.movementPattern,
    ...profile.aliases,
  ].map(normalize));

  for (const restriction of restrictions) {
    if (!restriction || restriction.status !== 'active') continue;
    const subject = normalize(restriction.subject || '');
    if (!subject) return {status: 'review', reason: 'An active restriction has no resolvable subject.'};

    if (restriction.category === 'pain_or_return') {
      return {
        status: 'review',
        reason: 'An active pain/return-to-training restriction needs the appropriate owner review before movement selection.',
      };
    }
    if (restriction.category === 'exercise') {
      if (aliases.has(subject)) {
        return {status: 'blocked', reason: 'This exact movement, variation or movement pattern is covered by an active exercise restriction.'};
      }
      return {
        status: 'review',
        reason: 'An active exercise restriction could not be safely mapped to a canonical movement or variation.',
      };
    }
    if (restriction.category === 'equipment') {
      if (
        profile.equipmentRequiredIds.some((id) => normalize(id) === subject) ||
        profile.equipmentOptionalIds.some((id) => normalize(id) === subject)
      ) {
        return {status: 'blocked', reason: 'The movement references equipment covered by an active equipment restriction.'};
      }
      return {
        status: 'review',
        reason: 'An active equipment restriction could not be resolved against canonical equipment IDs.',
      };
    }
    if (restriction.category === 'preference') {
      if (aliases.has(subject)) {
        return {status: 'blocked', reason: 'This movement matches an explicit athlete preference exclusion.'};
      }
      return {
        status: 'review',
        reason: 'An active movement preference could not be mapped to canonical movement metadata.',
      };
    }
    // Schedule restrictions are applied by the Training owner, not by a
    // movement selector. They are still retained in the upstream snapshot.
  }
  return {status: 'clear'};
}

/**
 * Evaluates one reviewed canonical variation against complete owner snapshots.
 * The output is explanatory evidence, not a dose, workout prescription or
 * autonomous recommendation write.
 */
export function evaluateExerciseSuitability(
  profile: ExerciseScienceProfile,
  context: ExerciseSuitabilityOwnerSnapshots,
): ExerciseSuitabilityResult {
  if (!profile) {
    return {
      status: 'review_required',
      movementId: '',
      variationId: '',
      displayName: '',
      reasonCodes: ['EXERCISE_PROFILE_MISSING'],
      explanation: 'The canonical exercise variation is unavailable.',
      noDoseOrPlanWrite: true,
    };
  }

  const validation = validateExerciseScienceProfile(profile);
  if (!validation.valid || !validation.coachEligible) {
    return stop(
      profile,
      'review_required',
      'EXERCISE_PROFILE_NOT_REVIEWED',
      'This exact variation does not have a reviewed, source-linked profile that is eligible for Coach.',
    );
  }

  if (!ownerContextIsComplete(context)) {
    return stop(
      profile,
      'review_required',
      'OWNER_CONTEXT_INCOMPLETE',
      'Goals, selected-location equipment, restrictions, strength experience and next-session Training context must all be confirmed by their canonical owners before a movement can be recommended.',
    );
  }

  if (
    !context.location.selectedLocationId ||
    !Array.isArray(context.location.confirmedEquipmentIds) ||
    !Array.isArray(context.goals.active) ||
    context.goals.active.length === 0 ||
    !Array.isArray(context.restrictions.active) ||
    !Array.isArray(context.trainingLoad.conflictingMuscleGroupIds)
  ) {
    return stop(
      profile,
      'review_required',
      'OWNER_SNAPSHOT_INVALID',
      'One or more owner snapshots are missing their required identity or collection values.',
    );
  }

  if (context.strengthExperience.skillLevel === 'unknown') {
    return stop(
      profile,
      'review_required',
      'STRENGTH_EXPERIENCE_UNKNOWN',
      'The athlete’s lifting experience is not confirmed, so this movement’s skill demand cannot be checked.',
    );
  }

  const skill = {beginner: 0, intermediate: 1, advanced: 2} as const;
  if (skill[context.strengthExperience.skillLevel] < skill[profile.skillLevel]) {
    return stop(
      profile,
      'review_required',
      'MOVEMENT_SKILL_EXCEEDS_CONFIRMED_EXPERIENCE',
      'This variation requires a higher skill level than the athlete’s confirmed strength experience. Review a sourced regression or alternative instead.',
    );
  }

  const restriction = restrictionDecision(profile, context.restrictions.active);
  if (restriction.status === 'blocked') {
    return stop(profile, 'blocked', 'ACTIVE_ATHLETE_RESTRICTION', restriction.reason ?? 'An active restriction excludes this movement.');
  }
  if (restriction.status === 'review') {
    return stop(profile, 'review_required', 'RESTRICTION_MAPPING_REQUIRES_REVIEW', restriction.reason ?? 'An active restriction needs review.');
  }

  const availableEquipment = new Set(context.location.confirmedEquipmentIds.map(normalize));
  const missingEquipment = profile.equipmentRequiredIds.filter((id) => !availableEquipment.has(normalize(id)));
  if (missingEquipment.length > 0) {
    return stop(
      profile,
      'blocked',
      'REQUIRED_EQUIPMENT_UNAVAILABLE',
      'The selected Training Location does not have all confirmed equipment required for this exact variation.',
    );
  }

  if (context.trainingLoad.nextSessionConflict === 'conflict') {
    return stop(
      profile,
      'review_required',
      'NEXT_SESSION_CONFLICT',
      'Training identified a conflict with the next planned session. Review timing or a compatible alternative; this selector will not alter the accepted plan.',
    );
  }
  if (context.trainingLoad.nextSessionConflict !== 'clear') {
    return stop(
      profile,
      'review_required',
      'NEXT_SESSION_CONFLICT_UNKNOWN',
      'Training has not confirmed whether this movement overlaps with the next planned session.',
    );
  }

  const evidenceMatches = matchesGoalClaims(profile, context.goals.active);
  if (evidenceMatches.length === 0) {
    const mechanismOnly = profile.claims.some((claim) => claim.directness === 'mechanistic_rationale');
    return stop(
      profile,
      'not_supported',
      mechanismOnly ? 'MECHANISTIC_RATIONALE_ONLY' : 'NO_MATCHING_GOAL_EVIDENCE',
      mechanismOnly
        ? 'The available evidence explains movement or muscle demands but does not establish a matching athlete goal or sport-performance benefit.'
        : 'No reviewed claim links this exact variation to the athlete’s active sport and goal context.',
    );
  }

  const directClaims = evidenceMatches.filter((match) => match.claim.directness === 'direct_sport_outcome');
  // Keep both direct sport-outcome and general-adaptation evidence visible.
  // A direct result does not erase useful context; the transfer label remains explicit.
  const selected = evidenceMatches;
  const limitations = [...new Set(selected.map((match) => match.claim.limitations))];
  const whyThisFits = selected.map((match) => match.claim.statement);
  const sourceIds = new Set([
    ...selected.flatMap((match) => match.claim.sourceIds),
    ...profile.muscleGroups.flatMap((muscle) => muscle.sourceIds),
    ...profile.jointDemands.flatMap((demand) => demand.sourceIds),
    ...profile.cautionFlags.flatMap((flag) => flag.sourceIds),
  ]);

  return {
    status: 'recommended',
    movementId: profile.movementId,
    variationId: profile.variationId,
    displayName: profile.displayName,
    variationDescription: profile.variationDescription,
    requiredEquipmentIds: profile.equipmentRequiredIds,
    optionalEquipmentIds: profile.equipmentOptionalIds,
    matchedGoalIds: [...new Set(selected.flatMap((match) => match.goalIds))],
    matchedSports: [...new Set(selected.flatMap((match) => match.sports))],
    transfer: directClaims.length > 0 ? 'direct_sport_evidence' : 'general_adaptation_indirect_transfer',
    whyThisFits,
    muscleRoles: profile.muscleGroups,
    jointDemands: profile.jointDemands,
    cautionFlags: profile.cautionFlags,
    alternativeVariationIds: profile.alternativeVariationIds,
    regressionVariationIds: profile.regressionVariationIds,
    progressionVariationIds: profile.progressionVariationIds,
    coachingCues: profile.coachingCues,
    sources: profile.sources.filter((source) => sourceIds.has(source.id)),
    evidence: selected.map((match) => ({
      claimId: match.claim.id,
      directness: match.claim.directness,
      evidenceTier: match.claim.evidenceTier,
      confidence: match.claim.confidence,
      sourceIds: match.claim.sourceIds,
      limitation: match.claim.limitations,
    })),
    limitations,
    noDoseOrPlanWrite: true,
  };
}
