/**
 * ALL-262: bridge trusted course matches into the existing race-pace reducer.
 *
 * Native Core Location owns collection. Race/Route owns the course geometry.
 * This adapter only binds one trusted match to the already-approved Training
 * workout/route package; untrusted fixes never become numeric course progress.
 */
import type {RaceCourseGpsMatch} from './raceCourseGpsMatcher.ts';
import type {RacePaceObservation,RacePacePackage} from './racePaceIndicator.ts';

export type RacePaceGpsObservationResult =
  | {status:'unavailable';reason:string;observation:null}
  | {status:'ready';observation:RacePaceObservation};

function unavailable(reason:string):RacePaceGpsObservationResult {
  return {status:'unavailable',reason,observation:null};
}

/**
 * expectedRaceId is supplied by the canonical race reference attached to the
 * same planned workout. It prevents a valid fix from another event being used.
 */
export function racePaceObservationFromGpsMatch(
  plan:RacePacePackage,
  expectedRaceId:string,
  match:RaceCourseGpsMatch,
  elapsedSeconds:number,
  recordingPaused:boolean,
):RacePaceGpsObservationResult {
  if(!plan?.enabled)return unavailable('Route-aware race guidance is disabled');
  if(typeof expectedRaceId!=='string'||!expectedRaceId.trim())
    return unavailable('Canonical race identity is unavailable');
  if(!match||match.status!=='trusted')
    return unavailable(match&&'reason'in match?match.reason:'Trusted GPS course match unavailable');
  if(match.raceId!==expectedRaceId||match.courseVersion!==plan.courseVersion)
    return unavailable('Race/course identity does not match the approved workout');
  if(typeof plan.routeId!=='string'||!plan.routeId.trim()||
    typeof plan.workoutId!=='string'||!plan.workoutId.trim())
    return unavailable('Approved workout or route identity is unavailable');
  if(!Number.isFinite(elapsedSeconds)||elapsedSeconds<0||
    typeof recordingPaused!=='boolean'||
    !Number.isFinite(match.distanceOnCourseMeters)||match.distanceOnCourseMeters<0)
    return unavailable('Workout timing or matched route distance is invalid');
  const totalMeters=plan.sections?.[plan.sections.length-1]?.endMeters;
  if(!Number.isFinite(totalMeters)||match.distanceOnCourseMeters>totalMeters)
    return unavailable('Matched course distance exceeds the approved workout route');

  return {
    status:'ready',
    observation:{
      workoutId:plan.workoutId,
      routeId:plan.routeId,
      courseVersion:plan.courseVersion,
      elapsedSeconds,
      distanceOnCourseMeters:match.distanceOnCourseMeters,
      // updateRacePaceLive derives movement pace from consecutive accepted
      // position observations; no first-fix speed is fabricated here.
      recentDistanceMeters:0,
      recentElapsedSeconds:0,
      routePositionTrusted:true,
      recordingPaused,
    },
  };
}
