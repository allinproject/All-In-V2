/**
 * ALL-262: bind the measured GPX elevation profile to already-approved race
 * pace sections. This enriches display/context; it never changes pace targets.
 */
import type {RaceGpxReadResult} from './raceCourseGpxReader.ts';
import type {RacePacePackage} from './racePaceIndicator.ts';

export type RacePaceSectionElevation = {
  sectionId: string;
  startMeters: number;
  endMeters: number;
  targetSecondsPerKm: number;
  plannedTerrain: 'flat' | 'climb' | 'descent' | 'rolling' | 'unknown';
  plannedGradePercent: number | null;
  measuredNetGradePercent: number | null;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  maximumUphillLegGradePercent: number | null;
  maximumDownhillLegGradePercent: number | null;
  elevationStatus: 'complete' | 'partial' | 'missing';
};

export type RacePaceCourseElevation =
  | {
      status: 'unavailable';
      reason: string;
      raceId: string;
      routeId: string;
      courseVersion: string;
      sections: readonly [];
      noAutomaticPlanWrite: true;
    }
  | {
      status: 'ready' | 'partial';
      raceId: string;
      routeId: string;
      courseVersion: string;
      totalDistanceMeters: number;
      sections: readonly RacePaceSectionElevation[];
      warnings: readonly string[];
      source: 'versioned_gpx_file_and_approved_pace_sections';
      noAutomaticPlanWrite: true;
    };

const DISTANCE_TOLERANCE_METERS = 0.5;
const SAMPLE_COVERAGE_TOLERANCE_METERS = 0.01;
const MAX_ROUTE_GAP_METERS = 500;

function unavailable(
  course: RaceGpxReadResult,
  plan: RacePacePackage,
  reason: string,
): RacePaceCourseElevation {
  return {
    status: 'unavailable',
    reason,
    raceId: course?.raceId ?? '',
    routeId: plan?.routeId ?? '',
    courseVersion: plan?.courseVersion ?? '',
    sections: [],
    noAutomaticPlanWrite: true,
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPlan(plan: RacePacePackage): boolean {
  if (
    !plan ||
    plan.enabled !== true ||
    typeof plan.workoutId !== 'string' ||
    !plan.workoutId.trim() ||
    typeof plan.routeId !== 'string' ||
    !plan.routeId.trim() ||
    typeof plan.courseVersion !== 'string' ||
    !plan.courseVersion.trim() ||
    !Array.isArray(plan.sections) ||
    plan.sections.length === 0 ||
    plan.sections.length > 10000
  ) return false;

  let previousEnd = 0;
  const ids = new Set<string>();
  for (let index = 0; index < plan.sections.length; index++) {
    const section = plan.sections[index];
    if (
      !section ||
      typeof section.id !== 'string' ||
      !section.id.trim() ||
      ids.has(section.id) ||
      !finite(section.startMeters) ||
      !finite(section.endMeters) ||
      section.startMeters < 0 ||
      section.endMeters <= section.startMeters ||
      !finite(section.targetSecondsPerKm) ||
      section.targetSecondsPerKm < 60 ||
      section.targetSecondsPerKm > 3600 ||
      !['flat', 'climb', 'descent', 'rolling', 'unknown'].includes(section.terrain) ||
      !(section.gradePercent === null || (finite(section.gradePercent) && section.gradePercent >= -50 && section.gradePercent <= 50)) ||
      (index === 0 && Math.abs(section.startMeters) > SAMPLE_COVERAGE_TOLERANCE_METERS) ||
      (index > 0 && Math.abs(section.startMeters - previousEnd) > SAMPLE_COVERAGE_TOLERANCE_METERS)
    ) return false;
    ids.add(section.id);
    previousEnd = section.endMeters;
  }
  return true;
}

/**
 * The GPX and pace package must represent the same canonical route/version
 * and distance axis. A section receives a numeric profile only when every
 * overlapping source leg has elevation; missing source samples remain unknown.
 */
export function racePaceCourseElevation(
  course: RaceGpxReadResult,
  plan: RacePacePackage,
): RacePaceCourseElevation {
  if (!course || course.status === 'unavailable') {
    return unavailable(course, plan, 'Verified GPX course geometry is unavailable');
  }
  if (!validPlan(plan)) {
    return unavailable(course, plan, 'Approved race pace package is invalid');
  }
  if (
    !course.routeId ||
    course.routeId !== plan.routeId ||
    course.courseVersion !== plan.courseVersion
  ) {
    return unavailable(course, plan, 'GPX route identity or course version does not match the approved pace package');
  }
  if (
    !Array.isArray(course.points) ||
    course.points.length < 2 ||
    course.points.length > 50000 ||
    !finite(course.totalDistanceMeters) ||
    course.totalDistanceMeters <= 0 ||
    !finite(course.points[0]?.cumulativeDistanceMeters) ||
    Math.abs(course.points[0].cumulativeDistanceMeters) > SAMPLE_COVERAGE_TOLERANCE_METERS ||
    !finite(course.points[course.points.length - 1]?.cumulativeDistanceMeters) ||
    Math.abs(course.points[course.points.length - 1].cumulativeDistanceMeters - course.totalDistanceMeters) > SAMPLE_COVERAGE_TOLERANCE_METERS
  ) {
    return unavailable(course, plan, 'GPX route distance axis is invalid');
  }

  for (let index = 0; index < course.points.length; index++) {
    const point = course.points[index];
    if (
      !point ||
      !finite(point.latitude) ||
      point.latitude < -90 ||
      point.latitude > 90 ||
      !finite(point.longitude) ||
      point.longitude < -180 ||
      point.longitude > 180 ||
      !finite(point.cumulativeDistanceMeters) ||
      !(point.elevationMeters === null || finite(point.elevationMeters))
    ) {
      return unavailable(course, plan, 'GPX route contains an invalid coordinate, distance or elevation sample');
    }
    if (index > 0) {
      const legMeters = point.cumulativeDistanceMeters - course.points[index - 1].cumulativeDistanceMeters;
      if (legMeters <= 0 || legMeters > MAX_ROUTE_GAP_METERS) {
        return unavailable(course, plan, 'GPX route samples are non-monotonic or too sparse for section elevation');
      }
    }
  }

  const lastPlanDistance = plan.sections[plan.sections.length - 1].endMeters;
  if (Math.abs(lastPlanDistance - course.totalDistanceMeters) > DISTANCE_TOLERANCE_METERS) {
    return unavailable(course, plan, 'Approved pace sections and GPX geometry use different course-distance axes');
  }

  const sections: RacePaceSectionElevation[] = [];
  for (const section of plan.sections) {
    let coveredMeters = 0;
    let measuredMeters = 0;
    let missingMeters = 0;
    let gainMeters = 0;
    let lossMeters = 0;
    let firstElevation: number | null = null;
    let lastElevation: number | null = null;
    let maximumUphill: number | null = null;
    let maximumDownhill: number | null = null;

    for (let index = 0; index < course.points.length - 1; index++) {
      const start = course.points[index];
      const end = course.points[index + 1];
      const legStartMeters = start.cumulativeDistanceMeters;
      const legEndMeters = end.cumulativeDistanceMeters;
      const overlapStartMeters = Math.max(section.startMeters, legStartMeters);
      const overlapEndMeters = Math.min(section.endMeters, legEndMeters);
      const overlapMeters = overlapEndMeters - overlapStartMeters;
      if (overlapMeters <= 0) continue;

      coveredMeters += overlapMeters;
      if (start.elevationMeters === null || end.elevationMeters === null) {
        missingMeters += overlapMeters;
        continue;
      }

      const legMeters = legEndMeters - legStartMeters;
      const elevationDelta = end.elevationMeters - start.elevationMeters;
      const startFraction = (overlapStartMeters - legStartMeters) / legMeters;
      const endFraction = (overlapEndMeters - legStartMeters) / legMeters;
      const clippedStartElevation = start.elevationMeters + elevationDelta * startFraction;
      const clippedEndElevation = start.elevationMeters + elevationDelta * endFraction;
      if (firstElevation === null) firstElevation = clippedStartElevation;
      lastElevation = clippedEndElevation;

      const clippedDelta = clippedEndElevation - clippedStartElevation;
      const clippedGradePercent = (clippedDelta / overlapMeters) * 100;
      measuredMeters += overlapMeters;
      if (clippedDelta > 0) gainMeters += clippedDelta;
      if (clippedDelta < 0) lossMeters += Math.abs(clippedDelta);
      if (clippedGradePercent > 0) {
        maximumUphill = maximumUphill === null
          ? clippedGradePercent
          : Math.max(maximumUphill, clippedGradePercent);
      } else if (clippedGradePercent < 0) {
        maximumDownhill = maximumDownhill === null
          ? clippedGradePercent
          : Math.min(maximumDownhill, clippedGradePercent);
      }
    }

    const sectionLengthMeters = section.endMeters - section.startMeters;
    if (Math.abs(coveredMeters - sectionLengthMeters) > DISTANCE_TOLERANCE_METERS) {
      return unavailable(course, plan, 'GPX samples do not fully cover an approved pace section');
    }

    const elevationStatus: RacePaceSectionElevation['elevationStatus'] =
      missingMeters <= SAMPLE_COVERAGE_TOLERANCE_METERS
        ? 'complete'
        : measuredMeters > SAMPLE_COVERAGE_TOLERANCE_METERS
          ? 'partial'
          : 'missing';
    const complete = elevationStatus === 'complete';

    sections.push({
      sectionId: section.id,
      startMeters: section.startMeters,
      endMeters: section.endMeters,
      targetSecondsPerKm: section.targetSecondsPerKm,
      plannedTerrain: section.terrain,
      plannedGradePercent: section.gradePercent,
      measuredNetGradePercent: complete && firstElevation !== null && lastElevation !== null
        ? ((lastElevation - firstElevation) / sectionLengthMeters) * 100
        : null,
      elevationGainMeters: complete ? gainMeters : null,
      elevationLossMeters: complete ? lossMeters : null,
      maximumUphillLegGradePercent: complete ? maximumUphill : null,
      maximumDownhillLegGradePercent: complete ? maximumDownhill : null,
      elevationStatus,
    });
  }

  const complete = sections.every((section) => section.elevationStatus === 'complete');
  const warnings = complete
    ? [...course.warnings]
    : [
        ...course.warnings,
        'One or more approved pace sections have missing or incomplete elevation; numeric grade and gain/loss remain unknown for those sections.',
      ];

  return {
    status: complete ? 'ready' : 'partial',
    raceId: course.raceId,
    routeId: course.routeId,
    courseVersion: course.courseVersion,
    totalDistanceMeters: course.totalDistanceMeters,
    sections,
    warnings: [...new Set(warnings)],
    source: 'versioned_gpx_file_and_approved_pace_sections',
    noAutomaticPlanWrite: true,
  };
}
