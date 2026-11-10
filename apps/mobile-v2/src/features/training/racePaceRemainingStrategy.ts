/**
 * ALL-262: deterministic remaining-race projection for an approved course plan.
 *
 * Recalculates projected finish time as trusted elapsed time and route progress
 * change. It never rewrites approved section targets and never prescribes a
 * faster catch-up pace when the original goal falls outside that strategy.
 */
import {
  racePaceIndicator,
  type RacePaceObservation,
  type RacePacePackage,
} from './racePaceIndicator.ts';

export type RacePaceGoalAssessment =
  | 'no_goal'
  | 'ahead_of_goal_projection'
  | 'within_approved_effort'
  | 'requires_faster_than_approved_strategy'
  | 'goal_time_elapsed'
  | 'finished';

export type RacePaceRemainingStrategy =
  | {
      status: 'unavailable';
      reason: string;
      workoutId: string;
      noAutomaticPlanWrite: true;
    }
  | {
      status: 'ready';
      workoutId: string;
      routeId: string;
      courseVersion: string;
      elapsedSeconds: number;
      remainingMeters: number;
      remainingApprovedSeconds: number;
      approvedRemainingAverageSecondsPerKm: number | null;
      projectedFinishSeconds: number;
      targetFinishSeconds: number | null;
      /** Positive means projected finish is later than the approved goal. */
      projectedGoalDeltaSeconds: number | null;
      /** Calculated for comparison only; never displayed as a command. */
      requiredRemainingSecondsPerKm: number | null;
      goalAssessment: RacePaceGoalAssessment;
      recommendedAction:
        | 'continue_approved_segments'
        | 'preserve_effort_and_revise_finish_expectation'
        | 'none';
      /** Deliberately null: no dynamic catch-up pace or automatic target update. */
      proposedCatchUpSecondsPerKm: null;
      noAutomaticPlanWrite: true;
      source: 'approved_course_targets_and_trusted_live_progress';
    };

const MAX_GOAL_SECONDS = 7 * 86400;
const MIN_DISTANCE_EPSILON_METERS = 0.01;

function unavailable(plan: RacePacePackage, reason: string): RacePaceRemainingStrategy {
  return {
    status: 'unavailable',
    reason,
    workoutId: typeof plan?.workoutId === 'string' ? plan.workoutId : '',
    noAutomaticPlanWrite: true,
  };
}

/**
 * approvedGoalFinishSeconds must be the athlete-approved absolute elapsed
 * finish time, not an AI prediction or an inferred goal. Omit it for effort-
 * based/ultra strategies without a time goal.
 */
export function racePaceRemainingStrategy(
  plan: RacePacePackage,
  observation: RacePaceObservation,
  approvedGoalFinishSeconds: number | null = null,
): RacePaceRemainingStrategy {
  const live = racePaceIndicator(plan, observation);
  if (live.status !== 'ready') {
    return unavailable(plan, live.reason);
  }
  if (
    approvedGoalFinishSeconds !== null &&
    (typeof approvedGoalFinishSeconds !== 'number' ||
      !Number.isFinite(approvedGoalFinishSeconds) ||
      approvedGoalFinishSeconds <= 0 ||
      approvedGoalFinishSeconds > MAX_GOAL_SECONDS)
  ) {
    return unavailable(plan, 'Approved goal finish time is invalid');
  }

  const remainingMeters = live.remainingMeters;
  let remainingApprovedSeconds = 0;
  for (const section of plan.sections) {
    const meters = Math.max(
      0,
      section.endMeters - Math.max(observation.distanceOnCourseMeters, section.startMeters),
    );
    remainingApprovedSeconds += (meters / 1000) * section.targetSecondsPerKm;
  }

  const remainingKm = remainingMeters / 1000;
  const approvedRemainingAverageSecondsPerKm =
    remainingKm > MIN_DISTANCE_EPSILON_METERS / 1000
      ? remainingApprovedSeconds / remainingKm
      : null;
  const projectedFinishSeconds = observation.elapsedSeconds + remainingApprovedSeconds;

  if (remainingMeters <= MIN_DISTANCE_EPSILON_METERS) {
    return {
      status: 'ready',
      workoutId: plan.workoutId,
      routeId: plan.routeId,
      courseVersion: plan.courseVersion,
      elapsedSeconds: observation.elapsedSeconds,
      remainingMeters: 0,
      remainingApprovedSeconds: 0,
      approvedRemainingAverageSecondsPerKm: null,
      projectedFinishSeconds: observation.elapsedSeconds,
      targetFinishSeconds: approvedGoalFinishSeconds,
      projectedGoalDeltaSeconds:
        approvedGoalFinishSeconds === null
          ? null
          : observation.elapsedSeconds - approvedGoalFinishSeconds,
      requiredRemainingSecondsPerKm: null,
      goalAssessment: 'finished',
      recommendedAction: 'none',
      proposedCatchUpSecondsPerKm: null,
      noAutomaticPlanWrite: true,
      source: 'approved_course_targets_and_trusted_live_progress',
    };
  }

  if (approvedGoalFinishSeconds === null) {
    return {
      status: 'ready',
      workoutId: plan.workoutId,
      routeId: plan.routeId,
      courseVersion: plan.courseVersion,
      elapsedSeconds: observation.elapsedSeconds,
      remainingMeters,
      remainingApprovedSeconds,
      approvedRemainingAverageSecondsPerKm,
      projectedFinishSeconds,
      targetFinishSeconds: null,
      projectedGoalDeltaSeconds: null,
      requiredRemainingSecondsPerKm: null,
      goalAssessment: 'no_goal',
      recommendedAction: 'continue_approved_segments',
      proposedCatchUpSecondsPerKm: null,
      noAutomaticPlanWrite: true,
      source: 'approved_course_targets_and_trusted_live_progress',
    };
  }

  const projectedGoalDeltaSeconds = projectedFinishSeconds - approvedGoalFinishSeconds;
  if (approvedGoalFinishSeconds <= observation.elapsedSeconds) {
    return {
      status: 'ready',
      workoutId: plan.workoutId,
      routeId: plan.routeId,
      courseVersion: plan.courseVersion,
      elapsedSeconds: observation.elapsedSeconds,
      remainingMeters,
      remainingApprovedSeconds,
      approvedRemainingAverageSecondsPerKm,
      projectedFinishSeconds,
      targetFinishSeconds: approvedGoalFinishSeconds,
      projectedGoalDeltaSeconds,
      requiredRemainingSecondsPerKm: null,
      goalAssessment: 'goal_time_elapsed',
      recommendedAction: 'preserve_effort_and_revise_finish_expectation',
      proposedCatchUpSecondsPerKm: null,
      noAutomaticPlanWrite: true,
      source: 'approved_course_targets_and_trusted_live_progress',
    };
  }

  const requiredRemainingSecondsPerKm =
    (approvedGoalFinishSeconds - observation.elapsedSeconds) / remainingKm;
  const requiresFaster =
    requiredRemainingSecondsPerKm + 0.5 < (approvedRemainingAverageSecondsPerKm ?? 0);
  const goalAssessment: RacePaceGoalAssessment = requiresFaster
    ? 'requires_faster_than_approved_strategy'
    : projectedGoalDeltaSeconds < -0.5
      ? 'ahead_of_goal_projection'
      : 'within_approved_effort';

  return {
    status: 'ready',
    workoutId: plan.workoutId,
    routeId: plan.routeId,
    courseVersion: plan.courseVersion,
    elapsedSeconds: observation.elapsedSeconds,
    remainingMeters,
    remainingApprovedSeconds,
    approvedRemainingAverageSecondsPerKm,
    projectedFinishSeconds,
    targetFinishSeconds: approvedGoalFinishSeconds,
    projectedGoalDeltaSeconds,
    requiredRemainingSecondsPerKm,
    goalAssessment,
    recommendedAction: requiresFaster
      ? 'preserve_effort_and_revise_finish_expectation'
      : 'continue_approved_segments',
    proposedCatchUpSecondsPerKm: null,
    noAutomaticPlanWrite: true,
    source: 'approved_course_targets_and_trusted_live_progress',
  };
}
