/** ALL-222/246: canonical revision day-state adapter for the existing calendar.
 * Day statuses are not workout sessions and never imply activity completion.
 * Only an authenticated, complete current-revision owner snapshot may call this.
 */
import {validAthleteLocalDate} from './manualActivityDraft.ts';
import type {CalendarWorkoutMarker} from './calendarDayView.ts';
export type CanonicalPlanDayState='planned'|'rest'|'recovery'|'unavailable'|'race'|'review_required';
export type CanonicalPlanDay={
 id:string;ownerId:string;planRevisionId:string;athleteLocalDate:string;
 dayState:CanonicalPlanDayState;
};
export function projectCanonicalPlanDayMarkers(input:{
 expectedOwnerId:string;activePlanRevisionId:string;complete:boolean;
 raceDate:string|null;days:readonly CanonicalPlanDay[];
}):CalendarWorkoutMarker[]{
 const {expectedOwnerId,activePlanRevisionId,complete,raceDate,days,raceDates}=input;
 if(!complete||!expectedOwnerId.trim()||!activePlanRevisionId.trim()||days.length>2000)
  throw new Error('Complete current-plan owner snapshot is required.');
 if(raceDate!==null&&!validAthleteLocalDate(raceDate))
  throw new Error('Invalid canonical race date.');
 if(raceDates!==undefined&&(
    raceDate!==null||!Array.isArray(raceDates)||raceDates.length>50||
    raceDates.some(date=>!validAthleteLocalDate(date))||
    new Set(raceDates).size!==raceDates.length))
  throw new Error('Distinct certified multi-event race dates required; do not combine legacy single race date.');
 const allowedRaceDates=new Set<string>(raceDates??(raceDate===null?[]:[raceDate]));
 const seen=new Set<string>();
 const markers:CalendarWorkoutMarker[]=[];
 for(const day of days){
  if(!day.id.trim()||day.ownerId!==expectedOwnerId||
   day.planRevisionId!==activePlanRevisionId||
   !validAthleteLocalDate(day.athleteLocalDate)||seen.has(day.athleteLocalDate))
   throw new Error('Invalid, foreign, stale or duplicate canonical plan day.');
  seen.add(day.athleteLocalDate);
  if(!['planned','rest','recovery','unavailable','race','review_required'].includes(day.dayState))
   throw new Error('Unsupported canonical plan day state.');
  if(day.dayState==='race'&&!allowedRaceDates.has(day.athleteLocalDate))
   throw new Error('Race-day status must match the certified exact goal race date.');
  if(day.dayState==='planned')continue; // Planned workouts come from revision-session rows only.
  markers.push({athleteLocalDate:day.athleteLocalDate,
   kind:day.dayState,status:day.dayState});
 }
 return markers;
}
