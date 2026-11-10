/**
 * ALL-262: bounded GPS-to-course projection for the Race/Route GPX geometry.
 *
 * This is a deterministic matcher over OS-provided coordinates, not a native
 * location collector. The first fix may scan the route; later fixes search a
 * bounded segment window around the last accepted match. Ambiguous/off-course
 * fixes never produce a trusted course distance.
 */
import type { RaceGpxReadResult } from './raceCourseGpxReader.ts';

export type RaceCourseGpsSample = {
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number;
  capturedAtMs: number;
};

export type RaceCourseGpsMatchState = {
  raceId: string;
  routeId: string;
  courseVersion: string;
  segmentIndex: number;
  capturedAtMs: number;
  distanceOnCourseMeters: number;
};

export type RaceCourseGpsMatch =
  | {
      status: 'untrusted';
      reason: string;
      confidence: 'untrusted';
      raceId: string;
      routeId: string | null;
      courseVersion: string;
      distanceOnCourseMeters: null;
      crossTrackDistanceMeters: number | null;
      state: RaceCourseGpsMatchState | null;
    }
  | {
      status: 'trusted';
      reason: null;
      confidence: 'high' | 'moderate';
      raceId: string;
      routeId: string;
      courseVersion: string;
      distanceOnCourseMeters: number;
      crossTrackDistanceMeters: number;
      segmentIndex: number;
      state: RaceCourseGpsMatchState;
    }
  | {
      status: 'reset_required';
      reason: 'race_or_course_version_changed';
      confidence: 'untrusted';
      raceId: string;
      routeId: string;
      courseVersion: string;
      distanceOnCourseMeters: null;
      crossTrackDistanceMeters: null;
      state: null;
    };

const MAX_HORIZONTAL_ACCURACY_METERS = 40;
const MAX_CROSS_TRACK_METERS = 60;
const MAX_ROUTE_SEGMENT_METERS = 500;
const MAX_RUN_SPEED_METERS_PER_SECOND = 12;
const MAX_FIX_GAP_MS = 120000;
const INITIAL_SEGMENT_SCAN_LIMIT = 50000;
const FOLLOWING_SEGMENT_WINDOW = 200;
const EARTH_METERS_PER_DEGREE_LAT = 111320;

type Candidate = {
  index: number;
  distanceOnCourseMeters: number;
  crossTrackDistanceMeters: number;
};

function untrusted(
  course: Extract<RaceGpxReadResult, { status: 'ready' | 'partial' }>,
  reason: string,
  state: RaceCourseGpsMatchState | null,
  crossTrackDistanceMeters: number | null = null,
): RaceCourseGpsMatch {
  return {
    status: 'untrusted',
    reason,
    confidence: 'untrusted',
    raceId: course.raceId,
    routeId: course.routeId,
    courseVersion: course.courseVersion,
    distanceOnCourseMeters: null,
    crossTrackDistanceMeters,
    state,
  };
}

function finite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Project one GPS fix to a single route segment in a local tangent plane. */
function projectToSegment(
  sample: RaceCourseGpsSample,
  a: { latitude: number; longitude: number; cumulativeDistanceMeters: number },
  b: { latitude: number; longitude: number; cumulativeDistanceMeters: number },
  index: number,
): Candidate | null {
  const meanLatitudeRadians =
    ((sample.latitude + a.latitude + b.latitude) / 3) * (Math.PI / 180);
  const metersPerDegreeLongitude =
    EARTH_METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos(meanLatitudeRadians));

  // Coordinates are relative to the GPS fix, keeping the projection numerically stable.
  const ax = (a.longitude - sample.longitude) * metersPerDegreeLongitude;
  const ay = (a.latitude - sample.latitude) * EARTH_METERS_PER_DEGREE_LAT;
  const bx = (b.longitude - sample.longitude) * metersPerDegreeLongitude;
  const by = (b.latitude - sample.latitude) * EARTH_METERS_PER_DEGREE_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!finite(lengthSquared) || lengthSquared <= 0) return null;

  const fraction = clamp(-(ax * dx + ay * dy) / lengthSquared, 0, 1);
  const closestX = ax + fraction * dx;
  const closestY = ay + fraction * dy;
  const crossTrackDistanceMeters = Math.hypot(closestX, closestY);
  const routeStart = a.cumulativeDistanceMeters;
  const routeEnd = b.cumulativeDistanceMeters;
  if (!finite(routeStart) || !finite(routeEnd) || routeEnd <= routeStart) return null;

  return {
    index,
    crossTrackDistanceMeters,
    distanceOnCourseMeters: routeStart + (routeEnd - routeStart) * fraction,
  };
}

/**
 * Return the closest unambiguous course projection. A previous accepted fix
 * narrows the search to a local segment window and enforces time/progress order.
 * On reset_required the caller must explicitly start a fresh matching sequence.
 */
export function matchRaceCourseGpsPosition(
  course: RaceGpxReadResult,
  sample: RaceCourseGpsSample,
  previous: RaceCourseGpsMatchState | null = null,
): RaceCourseGpsMatch {
  if (!course || course.status === 'unavailable' || !Array.isArray(course.points) || course.points.length < 2) {
    return {
      status: 'untrusted',
      reason: 'Verified course geometry unavailable',
      confidence: 'untrusted',
      raceId: course?.raceId ?? '',
      routeId: course && 'routeId' in course ? course.routeId : null,
      courseVersion: course?.courseVersion ?? '',
      distanceOnCourseMeters: null,
      crossTrackDistanceMeters: null,
      state: previous,
    };
  }

  if (!course.routeId || !course.routeId.trim()) return untrusted(course, 'Canonical route identity is unavailable', previous);

  if (
    !sample ||
    !finite(sample.latitude) || sample.latitude < -90 || sample.latitude > 90 ||
    !finite(sample.longitude) || sample.longitude < -180 || sample.longitude > 180 ||
    !finite(sample.horizontalAccuracyMeters) ||
    sample.horizontalAccuracyMeters <= 0 ||
    sample.horizontalAccuracyMeters > MAX_HORIZONTAL_ACCURACY_METERS ||
    !finite(sample.capturedAtMs) || sample.capturedAtMs <= 0
  ) return untrusted(course, 'GPS fix has invalid coordinates, accuracy or timestamp', previous);

  if (
    previous &&
    (previous.raceId !== course.raceId || previous.routeId !== course.routeId || previous.courseVersion !== course.courseVersion)
  ) {
    return {
      status: 'reset_required',
      reason: 'race_or_course_version_changed',
      confidence: 'untrusted',
      raceId: course.raceId,
      routeId: course.routeId,
      courseVersion: course.courseVersion,
      distanceOnCourseMeters: null,
      crossTrackDistanceMeters: null,
      state: null,
    };
  }

  let startIndex = 0;
  let endIndex = Math.min(course.points.length - 2, INITIAL_SEGMENT_SCAN_LIMIT - 1);
  if (previous) {
    const elapsedMs = sample.capturedAtMs - previous.capturedAtMs;
    if (!finite(elapsedMs) || elapsedMs <= 0) {
      return untrusted(course, 'GPS fix is stale or out of order', previous);
    }
    if (elapsedMs > MAX_FIX_GAP_MS) {
      return untrusted(course, 'GPS fix gap is too long to preserve route continuity', previous);
    }
    startIndex = Math.max(0, previous.segmentIndex - 3);
    endIndex = Math.min(
      course.points.length - 2,
      previous.segmentIndex + FOLLOWING_SEGMENT_WINDOW,
    );
  }
  if (endIndex < startIndex) return untrusted(course, 'No nearby route segments are available', previous);

  const candidates: Candidate[] = [];
  for (let index = startIndex; index <= endIndex; index++) {
    const a = course.points[index];
    const b = course.points[index + 1];
    const legMeters = b.cumulativeDistanceMeters - a.cumulativeDistanceMeters;
    // Long gaps are not suitable for trustworthy live map matching.
    if (!finite(legMeters) || legMeters <= 0 || legMeters > MAX_ROUTE_SEGMENT_METERS) continue;
    const candidate = projectToSegment(sample, a, b, index);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return untrusted(course, 'No continuous route segment could be matched', previous);

  candidates.sort((a, b) =>
    a.crossTrackDistanceMeters - b.crossTrackDistanceMeters ||
    a.distanceOnCourseMeters - b.distanceOnCourseMeters,
  );
  const best = candidates[0];
  const maximumMatchDistance = Math.min(
    MAX_CROSS_TRACK_METERS,
    Math.max(20, sample.horizontalAccuracyMeters * 1.5),
  );
  if (best.crossTrackDistanceMeters > maximumMatchDistance) {
    return untrusted(course, 'GPS fix is too far from the approved course', previous, best.crossTrackDistanceMeters);
  }

  // Nearby parallel switchbacks/loops can be geometrically ambiguous. A local
  // prior fix resolves continuity; without one, do not guess which lap/leg.
  const ambiguityDistance = Math.max(30, sample.horizontalAccuracyMeters * 2);
  const second = candidates.find(
    (candidate) =>
      Math.abs(candidate.index - best.index) > 1 &&
      Math.abs(candidate.distanceOnCourseMeters - best.distanceOnCourseMeters) > ambiguityDistance,
  );
  if (
    second &&
    second.crossTrackDistanceMeters - best.crossTrackDistanceMeters <=
      Math.max(3, sample.horizontalAccuracyMeters * 0.25)
  ) {
    return untrusted(course, 'Nearby course sections are ambiguous at this GPS accuracy', previous, best.crossTrackDistanceMeters);
  }

  if (previous) {
    const elapsedSeconds = (sample.capturedAtMs - previous.capturedAtMs) / 1000;
    const distanceDelta = best.distanceOnCourseMeters - previous.distanceOnCourseMeters;
    if (distanceDelta < -Math.max(8, sample.horizontalAccuracyMeters)) {
      return untrusted(course, 'GPS projection would move backwards on the course', previous, best.crossTrackDistanceMeters);
    }
    if (
      distanceDelta >
      MAX_RUN_SPEED_METERS_PER_SECOND * elapsedSeconds + Math.max(15, sample.horizontalAccuracyMeters)
    ) {
      return untrusted(course, 'GPS projection implies an implausible course-distance jump', previous, best.crossTrackDistanceMeters);
    }
  }

  const highConfidenceDistance = Math.max(12, sample.horizontalAccuracyMeters);
  const confidence =
    best.crossTrackDistanceMeters <= highConfidenceDistance ? 'high' : 'moderate';
  const state: RaceCourseGpsMatchState = {
    raceId: course.raceId,
    routeId: course.routeId,
    courseVersion: course.courseVersion,
    segmentIndex: best.index,
    capturedAtMs: sample.capturedAtMs,
    distanceOnCourseMeters: Math.max(previous?.distanceOnCourseMeters ?? 0, best.distanceOnCourseMeters),
  };

  return {
    status: 'trusted',
    reason: null,
    confidence,
    raceId: course.raceId,
    routeId: course.routeId,
    courseVersion: course.courseVersion,
    distanceOnCourseMeters: state.distanceOnCourseMeters,
    crossTrackDistanceMeters: best.crossTrackDistanceMeters,
    segmentIndex: best.index,
    state,
  };
}
