import test from 'node:test';
import assert from 'node:assert/strict';
import {readRaceGpx} from './raceCourseGpxReader.ts';
import {racePaceCourseElevation} from './racePaceCourseElevation.ts';
import type {RaceCourseEvidence} from './raceCourseEvidence.ts';
import type {RacePacePackage} from './racePaceIndicator.ts';

const evidence = (): Pick<RaceCourseEvidence, 'raceId' | 'routeId' | 'courseVersion' | 'routeFile'> => ({
  raceId: 'race-2027',
  routeId: 'route-2027',
  courseVersion: 'course-final-v2',
  routeFile: {kind: 'gpx', fileRef: 'organizer-route.gpx', source: 'organizer_gpx'},
});

const xml = (elevations: Array<number | null>) => `<gpx><trk><trkseg>${elevations.map((ele, index) =>
  `<trkpt lat="${44.95 + index * 0.001}" lon="-93.1">${ele === null ? '' : `<ele>${ele}</ele>`}</trkpt>`
).join('')}</trkseg></trk></gpx>`;

const course = (elevations: Array<number | null>) => readRaceGpx(xml(elevations), evidence());

const plan = (distance: number, split: number): RacePacePackage => ({
  workoutId: 'race-workout',
  routeId: 'route-2027',
  courseVersion: 'course-final-v2',
  enabled: true,
  sections: [
    {id: 'section-1', startMeters: 0, endMeters: split, targetSecondsPerKm: 360, terrain: 'climb', gradePercent: 5},
    {id: 'section-2', startMeters: split, endMeters: distance, targetSecondsPerKm: 420, terrain: 'descent', gradePercent: -3},
  ],
});

test('joins measured GPX elevation to exact approved pace sections without changing targets', () => {
  const route = course([200, 210, 205]);
  assert.equal(route.status, 'ready');
  if (route.status !== 'ready') return;
  const split = route.points[1].cumulativeDistanceMeters;
  const result = racePaceCourseElevation(route, plan(route.totalDistanceMeters, split));
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.raceId, 'race-2027');
  assert.equal(result.routeId, 'route-2027');
  assert.equal(result.courseVersion, 'course-final-v2');
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].sectionId, 'section-1');
  assert.ok(Math.abs((result.sections[0].elevationGainMeters ?? 0) - 10) < 0.001);
  assert.equal(result.sections[0].elevationLossMeters, 0);
  assert.ok((result.sections[0].measuredNetGradePercent ?? 0) > 0);
  assert.equal(result.sections[0].targetSecondsPerKm, 360);
  assert.equal(result.sections[1].elevationGainMeters, 0);
  assert.ok(Math.abs((result.sections[1].elevationLossMeters ?? 0) - 5) < 0.001);
  assert.ok((result.sections[1].measuredNetGradePercent ?? 0) < 0);
  assert.equal(result.sections[1].targetSecondsPerKm, 420);
  assert.equal(result.noAutomaticPlanWrite, true);
});

test('missing elevation remains partial or missing instead of inventing a flat section', () => {
  const route = course([200, null, 205]);
  assert.equal(route.status, 'partial');
  if (route.status !== 'partial') return;
  const split = route.points[1].cumulativeDistanceMeters;
  const result = racePaceCourseElevation(route, plan(route.totalDistanceMeters, split));
  assert.equal(result.status, 'partial');
  if (result.status !== 'partial') return;
  assert.equal(result.sections[0].elevationStatus, 'partial');
  assert.equal(result.sections[0].measuredNetGradePercent, null);
  assert.equal(result.sections[0].elevationGainMeters, null);
  assert.equal(result.sections[1].elevationStatus, 'partial');
  assert.equal(result.sections[1].measuredNetGradePercent, null);
});

test('sections with no elevation samples report missing rather than zero grade', () => {
  const route = course([null, null, null]);
  assert.equal(route.status, 'partial');
  if (route.status !== 'partial') return;
  const split = route.points[1].cumulativeDistanceMeters;
  const result = racePaceCourseElevation(route, plan(route.totalDistanceMeters, split));
  assert.equal(result.status, 'partial');
  if (result.status !== 'partial') return;
  assert.equal(result.sections[0].elevationStatus, 'missing');
  assert.equal(result.sections[0].measuredNetGradePercent, null);
  assert.equal(result.sections[0].elevationGainMeters, null);
  assert.equal(result.sections[1].elevationStatus, 'missing');
});

test('rejects a different canonical route or course version', () => {
  const route = course([200, 210, 205]);
  if (route.status !== 'ready') return;
  const split = route.points[1].cumulativeDistanceMeters;
  const basePlan = plan(route.totalDistanceMeters, split);
  assert.equal(racePaceCourseElevation({...route, routeId: 'other-route'}, basePlan).status, 'unavailable');
  assert.equal(racePaceCourseElevation({...route, courseVersion: 'old-version'}, basePlan).status, 'unavailable');
  assert.equal(racePaceCourseElevation({...route, routeId: null}, basePlan).status, 'unavailable');
});

test('rejects mismatched distance axes, gaps, duplicate sections and incomplete GPX coverage', () => {
  const route = course([200, 210, 205]);
  if (route.status !== 'ready') return;
  const split = route.points[1].cumulativeDistanceMeters;
  const basePlan = plan(route.totalDistanceMeters, split);
  const second = basePlan.sections[1];

  assert.equal(racePaceCourseElevation(route, {...basePlan, sections:[
    basePlan.sections[0], {...second, endMeters: second.endMeters + 5},
  ]}).status, 'unavailable');

  assert.equal(racePaceCourseElevation(route, {...basePlan, sections:[
    basePlan.sections[0], {...second, startMeters: split + 3},
  ]}).status, 'unavailable');

  assert.equal(racePaceCourseElevation(route, {...basePlan, sections:[
    basePlan.sections[0], {...second, endMeters: second.endMeters - 5},
  ]}).status, 'unavailable');

  assert.equal(racePaceCourseElevation(route, {...basePlan, sections:[
    basePlan.sections[0], {...second, id: basePlan.sections[0].id},
  ]}).status, 'unavailable');
});

test('disabled or invalid pace packages cannot be paired with a race course', () => {
  const route = course([200, 210, 205]);
  if (route.status !== 'ready') return;
  const split = route.points[1].cumulativeDistanceMeters;
  const basePlan = plan(route.totalDistanceMeters, split);
  assert.equal(racePaceCourseElevation(route, {...basePlan, enabled: false}).status, 'unavailable');
  assert.equal(racePaceCourseElevation(route, {...basePlan, sections:[
    {...basePlan.sections[0], startMeters: 5}, basePlan.sections[1],
  ]}).status, 'unavailable');
});
