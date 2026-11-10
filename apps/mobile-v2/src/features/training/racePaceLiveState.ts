/**
 * ALL-262: pure per-sample source validation and smoothing for the existing
 * racePaceIndicator. Native Watch will own GPS route matching and persistence.
 * Never a new workout, route, pace plan, or automatic target writer.
 */
import {racePaceIndicator,type RacePaceIndicator,type RacePaceObservation,type RacePacePackage} from './racePaceIndicator.ts';

export type RacePaceLiveState={
 workoutId:string;routeId:string;courseVersion:string;
 lastElapsedSeconds:number;lastDistanceMeters:number;
 /** Smoothed recent movement pace. null until comparable movement exists. */
 smoothSecondsPerKm:number|null;
};
export type RacePaceLiveUpdate={
 state:RacePaceLiveState|null;
 indicator:RacePaceIndicator;
 acceptance:'accepted'|'held'|'reset_required';
 reason:string|null;
};
const MAX_RUN_SPEED_MPS=12;
const MAX_WINDOW_SECONDS=120;
const MAX_PACE_SECONDS_KM=3600;
const MIN_PACE_SECONDS_KM=60;
function validNumber(n:number):boolean{return typeof n==='number'&&Number.isFinite(n);}
function sameIdentity(state:RacePaceLiveState,sample:RacePaceObservation):boolean{
 return state.workoutId===sample.workoutId&&state.routeId===sample.routeId&&
  state.courseVersion===sample.courseVersion;
}
function unavailable(plan:RacePacePackage,why:string):RacePaceIndicator{
 return {status:'unavailable',reason:why,workoutId:typeof plan?.workoutId==='string'?plan.workoutId:''};
}
/**
 * Consume exactly one trusted native position observation.
 * "held" never advances the accepted sample; a later valid sample can recover.
 * To prevent a paused/stationary or stale stream displaying old pace as live,
 * those updates explicitly clear current moving pace on the display.
 */
export function updateRacePaceLive(
 plan:RacePacePackage,sample:RacePaceObservation,previous:RacePaceLiveState|null,
):RacePaceLiveUpdate{
 const baseline=racePaceIndicator(plan,sample);
 if(baseline.status!=='ready')return {state:previous,indicator:baseline,
  acceptance:'held',reason:baseline.reason};
 if(previous&&!sameIdentity(previous,sample))return {
  state:null,indicator:unavailable(plan,'Workout/route version changed; refresh approved guidance'),
  acceptance:'reset_required',reason:'identity_or_course_changed',
 };
 const t=sample.elapsedSeconds,d=sample.distanceOnCourseMeters;
 if(previous){
  const dt=t-previous.lastElapsedSeconds,dd=d-previous.lastDistanceMeters;
  if(!validNumber(dt)||!validNumber(dd)||dt<=0||dd< -2)return {
   state:previous,indicator:unavailable(plan,'Stale or backwards race location update'),
   acceptance:'held',reason:'out_of_order_or_backwards',
  };
  // A large GPS route-position jump must not create fake lead or a fast split.
  // The small allowance tolerates bounded route projection noise.
  if(dd>MAX_RUN_SPEED_MPS*dt+8)return {
   state:previous,indicator:unavailable(plan,'Implausible course-distance jump'),
   acceptance:'held',reason:'gps_jump',
  };
  const shortSample=dt<3;
  const staleSample=dt>MAX_WINDOW_SECONDS;
  const moving=!sample.recordingPaused&&!shortSample&&!staleSample&&dd>=15;
  const pace=moving?dt*1000/dd:null;
  const plausible=pace!==null&&Number.isFinite(pace)&&pace>=MIN_PACE_SECONDS_KM&&pace<=MAX_PACE_SECONDS_KM;
  // Smoothing is display-only, not a new planned or suggested pace. Use a
  // bounded update to reduce jitter without swallowing sustained pace changes.
  const smoothed=plausible?
    previous.smoothSecondsPerKm===null?pace:
    previous.smoothSecondsPerKm*0.65+pace*0.35:null;
  const adjusted:RacePaceObservation={...sample,
   recentElapsedSeconds:smoothed===null?0:Math.max(15,Math.min(1800,smoothed)),
   recentDistanceMeters:smoothed===null?0:1000,
  };
  const indicator=racePaceIndicator(plan,adjusted);
  if(indicator.status!=='ready')return {state:previous,indicator,acceptance:'held',reason:'indicator_unavailable'};
  return {state:{workoutId:sample.workoutId,routeId:sample.routeId,
    courseVersion:sample.courseVersion,lastElapsedSeconds:t,lastDistanceMeters:d,
    smoothSecondsPerKm:smoothed},indicator,acceptance:'accepted',reason:null};
 }
 // First sample does not provide a trustworthy *change* in distance; route
 // progress is usable, but do not invent a moving speed from startup alone.
 const first=racePaceIndicator(plan,{...sample,recentElapsedSeconds:0,recentDistanceMeters:0});
 if(first.status!=='ready')return {state:null,indicator:first,acceptance:'held',reason:'indicator_unavailable'};
 return {state:{workoutId:sample.workoutId,routeId:sample.routeId,
   courseVersion:sample.courseVersion,lastElapsedSeconds:t,lastDistanceMeters:d,
   smoothSecondsPerKm:null},indicator:first,acceptance:'accepted',reason:null};
}
