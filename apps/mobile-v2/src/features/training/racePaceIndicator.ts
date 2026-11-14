/**
 * ALL-262: local, deterministic race-watch pace display projection.
 *
 * Inputs are an already-approved, version-matched canonical scheduled-workout
 * execution package, NOT a new route store, course estimator or AI generated
 * pacing plan. GPS/course match confidence must be established by the native
 * route owner. No automatic target rewrites or workout writes.
 */
export type RacePaceSection={
 id:string;startMeters:number;endMeters:number;
 targetSecondsPerKm:number;
 terrain:'flat'|'climb'|'descent'|'rolling'|'unknown';
 /** Display-only verified elevation context, not used to invent a target. */
 gradePercent:number|null;
};
export type RacePacePackage={
 workoutId:string;routeId:string;courseVersion:string;
 sections:readonly RacePaceSection[];
 enabled:boolean;
};
export type RacePaceObservation={
 workoutId:string;routeId:string;courseVersion:string;
 elapsedSeconds:number;distanceOnCourseMeters:number;
 recentDistanceMeters:number;recentElapsedSeconds:number;
 /** Native owner has already validated GPS and matching to approved route. */
 routePositionTrusted:boolean;
 recordingPaused:boolean;
};
export type RacePaceIndicator=
 |{status:'disabled'|'unavailable';reason:string;workoutId:string}
 |{status:'ready';workoutId:string;sectionId:string;terrain:RacePaceSection['terrain'];
   gradePercent:number|null;
   currentSecondsPerKm:number|null;targetSecondsPerKm:number;
   /** Positive value = ahead of approved section-time budget. */
   aheadSeconds:number;nextTerrain:RacePaceSection['terrain']|null;
   metersToNextSection:number|null;remainingMeters:number;
   /** Observation only; never an instruction to speed up. */
   paceRelation:'faster_than_segment_target'|'slower_than_segment_target'|'at_segment_target'|'unknown';
   source:'approved_course_and_live_observation';noAutomaticPlanWrite:true};
const MAX_METERS=1000000;const MAX_SEC=7*86400;
function finiteIn(value:number,min:number,max:number){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
function packageValid(p:RacePacePackage):boolean{
 if(!p||typeof p.workoutId!=='string'||!p.workoutId.trim()||!p.routeId?.trim()||
   !p.courseVersion?.trim()||!Array.isArray(p.sections)||p.sections.length===0||p.sections.length>10000)return false;
 let previousEnd=0;
 const sectionIds=new Set<string>();
 for(const [index,s]of p.sections.entries()){
  if(!s||typeof s.id!=='string'||!s.id.trim()||sectionIds.has(s.id)||!finiteIn(s.startMeters,0,MAX_METERS)||
   !finiteIn(s.endMeters,0,MAX_METERS)||s.endMeters<=s.startMeters||
   !finiteIn(s.targetSecondsPerKm,60,3600)||
   !['flat','climb','descent','rolling','unknown'].includes(s.terrain)||
   !(s.gradePercent===null||finiteIn(s.gradePercent,-50,50))||
   (index===0&&s.startMeters!==0)||
   (index>0&&Math.abs(s.startMeters-previousEnd)>0.01))return false;
  sectionIds.add(s.id);
  previousEnd=s.endMeters;
 }
 return true;
}
export function racePaceIndicator(
 plan:RacePacePackage,actual:RacePaceObservation,
):RacePaceIndicator{
 const id=typeof plan?.workoutId==='string'?plan.workoutId:'';
 if(!plan?.enabled)return {status:'disabled',reason:'Route-aware pace display disabled',workoutId:id};
 if(!packageValid(plan))return {status:'unavailable',reason:'Approved race course/targets unavailable',workoutId:id};
 if(!actual||actual.workoutId!==plan.workoutId||actual.routeId!==plan.routeId||
    actual.courseVersion!==plan.courseVersion||!actual.routePositionTrusted)
  return {status:'unavailable',reason:'Verified live position or course version unavailable',workoutId:id};
 const total=plan.sections[plan.sections.length-1].endMeters;
 if(!finiteIn(actual.distanceOnCourseMeters,0,total)||!finiteIn(actual.elapsedSeconds,0,MAX_SEC)||
   !finiteIn(actual.recentDistanceMeters,0,20000)||!finiteIn(actual.recentElapsedSeconds,0,1800))
  return {status:'unavailable',reason:'Live timing or route distance invalid',workoutId:id};
 // At an exact boundary, switch to the next segment. At finish, remain in last.
 const at=actual.distanceOnCourseMeters;
 const index=plan.sections.findIndex((s,i)=>at<s.endMeters||i===plan.sections.length-1);
 const section=plan.sections[index];
 let planned=0;
 for(let i=0;i<index;i++){
  const s=plan.sections[i];
  planned+=(s.endMeters-s.startMeters)*s.targetSecondsPerKm/1000;
 }
 planned+=(at-section.startMeters)*section.targetSecondsPerKm/1000;
 const pace=actual.recordingPaused||actual.recentElapsedSeconds<15||actual.recentDistanceMeters<15?
  null:actual.recentElapsedSeconds*1000/actual.recentDistanceMeters;
 const currentSecondsPerKm=pace!==null&&finiteIn(pace,60,3600)?pace:null;
 const difference=currentSecondsPerKm===null?0:currentSecondsPerKm-section.targetSecondsPerKm;
 const relation=currentSecondsPerKm===null?'unknown':Math.abs(difference)<5?'at_segment_target':
  difference<0?'faster_than_segment_target':'slower_than_segment_target';
 const next=plan.sections[index+1]??null;
 return {
  status:'ready',workoutId:id,sectionId:section.id,terrain:section.terrain,
  gradePercent:section.gradePercent,currentSecondsPerKm,
  targetSecondsPerKm:section.targetSecondsPerKm,
  aheadSeconds:Math.round(planned-actual.elapsedSeconds),
  nextTerrain:next?.terrain??null,
  metersToNextSection:next?Math.max(0,section.endMeters-at):null,
  remainingMeters:Math.max(0,total-at),paceRelation:relation,
  source:'approved_course_and_live_observation',noAutomaticPlanWrite:true,
 };
}
