/**
 * ALL-234 / ALL-262: read-only GPX geometry and elevation intake.
 *
 * The Race/Route owner supplies the exact race/course version and verified
 * GPX file bytes. This parser does not fetch websites, persist a route, create
 * pace targets, or turn sparse/unknown elevation into invented terrain.
 */
import type { RaceCourseEvidence } from './raceCourseEvidence.ts';

export type RaceGpxPoint = {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  cumulativeDistanceMeters: number;
  /** Grade from the previous source point; null when elevation is unknown. */
  gradeFromPreviousPercent: number | null;
};

export type RaceGpxReadResult =
  | {
      status: 'unavailable';
      reason: string;
      raceId: string;
      courseVersion: string;
    }
  | {
      status: 'ready' | 'partial';
      raceId: string;
      courseVersion: string;
      geometryKind: 'track' | 'route';
      points: readonly RaceGpxPoint[];
      totalDistanceMeters: number;
      elevationGainMeters: number | null;
      elevationLossMeters: number | null;
      elevationStatus: 'complete' | 'partial' | 'missing';
      warnings: readonly string[];
      source: 'versioned_gpx_file';
      noAutomaticPlanWrite: true;
    };

const MAX_XML_CHARACTERS = 20 * 1024 * 1024;
const MAX_POINTS = 50000;
const MAX_COURSE_METERS = 1000000;
const EARTH_RADIUS_METERS = 6371000;
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';

function unavailable(
  evidence: Pick<RaceCourseEvidence, 'raceId' | 'courseVersion'>,
  reason: string,
): RaceGpxReadResult {
  return {
    status: 'unavailable',
    reason,
    raceId: typeof evidence?.raceId === 'string' ? evidence.raceId : '',
    courseVersion: typeof evidence?.courseVersion === 'string' ? evidence.courseVersion : '',
  };
}

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const radians = Math.PI / 180;
  const dLat = (bLat - aLat) * radians;
  const dLon = (bLon - aLon) * radians;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * radians) * Math.cos(bLat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(x)));
}

function quotedAttribute(attributes: string, name: string): number | null {
  const doubleQuoted = attributes.match(new RegExp("\\b" + name + "\\s*=\\s*\"(" + NUMBER + ")\"", 'i'));
  const singleQuoted = attributes.match(new RegExp("\\b" + name + "\\s*=\\s*'(" + NUMBER + ")'", 'i'));
  const raw = doubleQuoted?.[1] ?? singleQuoted?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parsePoints(
  body: string,
  tag: 'trkpt' | 'rtept',
): Array<{ latitude: number; longitude: number; elevationMeters: number | null }> | null {
  const escapedTag = tag;
  const pointPattern = new RegExp(
    '<((?:[A-Za-z_][\\w.-]*:)?)' + escapedTag + '\\b([^>]*)>([\\s\\S]*?)<\\/\\1' + escapedTag + '\\s*>',
    'gi',
  );
  const matches = [...body.matchAll(pointPattern)];
  const openingCount = (body.match(new RegExp('<(?:[A-Za-z_][\\w.-]*:)?' + escapedTag + '\\b', 'gi')) || []).length;
  if (matches.length < 2 || matches.length !== openingCount || matches.length > MAX_POINTS) return null;

  const points: Array<{ latitude: number; longitude: number; elevationMeters: number | null }> = [];
  for (const match of matches) {
    const latitude = quotedAttribute(match[2], 'lat');
    const longitude = quotedAttribute(match[2], 'lon');
    if (
      latitude === null || longitude === null ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180
    ) return null;

    const elevationMatch = match[3].match(
      /<((?:[A-Za-z_][\w.-]*:)?)ele\b[^>]*>\s*([^<]*?)\s*<\/\1ele\s*>/i,
    );
    let elevationMeters: number | null = null;
    if (elevationMatch) {
      const raw = elevationMatch[2].trim();
      if (!new RegExp('^' + NUMBER + '$').test(raw)) return null;
      elevationMeters = Number(raw);
      if (!Number.isFinite(elevationMeters) || elevationMeters < -500 || elevationMeters > 9000) return null;
    }
    points.push({ latitude, longitude, elevationMeters });
  }
  return points;
}

/**
 * The evidence must be validated by validateRaceCourseEvidence before this
 * call. Its routeFile is the selected, source-attributed GPX artifact.
 */
export function readRaceGpx(
  xml: string,
  evidence: Pick<RaceCourseEvidence, 'raceId' | 'courseVersion' | 'routeFile'>,
): RaceGpxReadResult {
  if (
    !evidence || typeof evidence.raceId !== 'string' || !evidence.raceId.trim() ||
    typeof evidence.courseVersion !== 'string' || !evidence.courseVersion.trim() ||
    evidence.routeFile?.kind !== 'gpx' || typeof evidence.routeFile.fileRef !== 'string' ||
    !evidence.routeFile.fileRef.trim()
  ) return unavailable(evidence, 'A versioned GPX course artifact is required');

  if (typeof xml !== 'string' || xml.length === 0 || xml.length > MAX_XML_CHARACTERS) {
    return unavailable(evidence, 'GPX file is empty or exceeds the supported size');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b|<(?:[^>]+)\s(?:SYSTEM|PUBLIC)\s*=/i.test(xml)) {
    return unavailable(evidence, 'GPX document declarations and external entities are not supported');
  }
  if (!/<((?:[A-Za-z_][\w.-]*:)?)gpx\b/i.test(xml)) {
    return unavailable(evidence, 'Input is not a GPX document');
  }

  const trackSegments = [...xml.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)trkseg\b[^>]*>([\s\S]*?)<\/\1trkseg\s*>/gi)];
  const routeBlocks = [...xml.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)rte\b[^>]*>([\s\S]*?)<\/\1rte\s*>/gi)];
  if (trackSegments.length > 1 || routeBlocks.length > 1 || (trackSegments.length > 0 && routeBlocks.length > 0)) {
    return unavailable(evidence, 'Multiple or mixed GPX route segments require explicit continuity review');
  }

  let geometryKind: 'track' | 'route';
  let rawPoints: ReturnType<typeof parsePoints>;
  if (trackSegments.length === 1) {
    geometryKind = 'track';
    rawPoints = parsePoints(trackSegments[0][2], 'trkpt');
  } else if (routeBlocks.length === 1) {
    geometryKind = 'route';
    rawPoints = parsePoints(routeBlocks[0][2], 'rtept');
  } else {
    return unavailable(evidence, 'GPX must contain one continuous track segment or one route');
  }
  if (!rawPoints || rawPoints.length < 2) {
    return unavailable(evidence, 'GPX route geometry is malformed or has fewer than two points');
  }

  const points: RaceGpxPoint[] = [];
  let totalDistanceMeters = 0;
  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  let allElevationPresent = rawPoints.every((point) => point.elevationMeters !== null);
  const warnings: string[] = [];

  for (let index = 0; index < rawPoints.length; index++) {
    const current = rawPoints[index];
    const previous = rawPoints[index - 1];
    let gradeFromPreviousPercent: number | null = null;
    if (previous) {
      const legMeters = haversineMeters(
        previous.latitude, previous.longitude, current.latitude, current.longitude,
      );
      if (!Number.isFinite(legMeters) || legMeters <= 0) {
        return unavailable(evidence, 'GPX has duplicate or invalid consecutive route coordinates');
      }
      totalDistanceMeters += legMeters;
      if (totalDistanceMeters > MAX_COURSE_METERS) {
        return unavailable(evidence, 'GPX route exceeds the supported 1000 km course length');
      }
      if (previous.elevationMeters !== null && current.elevationMeters !== null) {
        const elevationDelta = current.elevationMeters - previous.elevationMeters;
        gradeFromPreviousPercent = (elevationDelta / legMeters) * 100;
        if (elevationDelta > 0) elevationGainMeters += elevationDelta;
        if (elevationDelta < 0) elevationLossMeters += Math.abs(elevationDelta);
      }
      if (legMeters > 500) warnings.push('Sparse GPX geometry includes a route-point gap over 500 m; live map matching may be less certain.');
    }
    points.push({
      latitude: current.latitude,
      longitude: current.longitude,
      elevationMeters: current.elevationMeters,
      cumulativeDistanceMeters: totalDistanceMeters,
      gradeFromPreviousPercent,
    });
  }

  if (!allElevationPresent) {
    warnings.push('One or more GPX points omit elevation; course elevation and grade guidance remain partial.');
  }
  if (allElevationPresent) {
    warnings.push('Elevation gain/loss are calculated from adjacent GPX samples; the source vertical accuracy is not independently verified.');
  }
  if (points.length > 1 && points.some((point) => point.gradeFromPreviousPercent !== null && Math.abs(point.gradeFromPreviousPercent) > 35)) {
    warnings.push('One or more source elevation legs exceed 35% grade; review the course profile before pace guidance.');
  }

  return {
    status: allElevationPresent ? 'ready' : 'partial',
    raceId: evidence.raceId,
    courseVersion: evidence.courseVersion,
    geometryKind,
    points,
    totalDistanceMeters,
    elevationGainMeters: allElevationPresent ? elevationGainMeters : null,
    elevationLossMeters: allElevationPresent ? elevationLossMeters : null,
    elevationStatus: allElevationPresent ? 'complete' : 'partial',
    warnings: [...new Set(warnings)],
    source: 'versioned_gpx_file',
    noAutomaticPlanWrite: true,
  };
}
