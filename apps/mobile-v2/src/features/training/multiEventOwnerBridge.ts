/**
 * ALL-231: bridge a certified Training owner snapshot into review-only multi-event
 * season planning. Does not fetch, mutate, or independently own Training records.
 */
import {certifyCalendarOwnerRead,type OwnerCalendarWindowSnapshot} from './calendarOwnerReadCertification.ts';
import {buildMultiEventSeasonPlan,type SeasonEvent,type SeasonPlanDraft} from './multiEventSeasonPlan.ts';
import type {PlannedCalendarItem} from './trainingCalendarReadModel.ts';
import type {CanonicalPlanDay} from './canonicalPlanDayMarkers.ts';

export type SeasonOwnerBinding={eventId:string;sessionId:string;planRevisionId:string};
export type MultiEventOwnerResult=
 | {status:'unavailable';reason:string;proposal:null}
 | {status:'review_required'|'blocked';reason:null;proposal:SeasonPlanDraft;planRevisionId:string;snapshotVersion:string};

export function proposeSeasonFromVerifiedTraining(input:{
 expectedOwnerId:string;authenticatedOwnerId:string|null;activeSessionGeneration:number;
 accessGateReady:boolean;activePlanRevisionId:string;startDate:string;
 events:readonly SeasonEvent[];eventBindings:readonly SeasonOwnerBinding[];
 plannedSnapshot:OwnerCalendarWindowSnapshot<PlannedCalendarItem>|null;
 daySnapshot:OwnerCalendarWindowSnapshot<CanonicalPlanDay>|null;
}):MultiEventOwnerResult {
 const unavailable=(reason:string):MultiEventOwnerResult=>({status:'unavailable',reason,proposal:null});
 const {events}=input;
 if(!Array.isArray(events)||!events.length||!Array.isArray(input.eventBindings)||
   !input.expectedOwnerId?.trim()||!input.activePlanRevisionId?.trim()||
   !input.plannedSnapshot||!input.daySnapshot)return unavailable('missing_authoritative_training');
 const endDate=events.reduce((max,e)=>typeof e?.date==='string'&&e.date>max?e.date:max,'');
 const shared={
  expectedOwnerId:input.expectedOwnerId,authenticatedOwnerId:input.authenticatedOwnerId,
  activeSessionGeneration:input.activeSessionGeneration,accessGateReady:input.accessGateReady,
  requestedFromDate:input.startDate,requestedThroughDate:endDate
 };
 const planned=certifyCalendarOwnerRead({...shared,snapshot:input.plannedSnapshot});
 const days=certifyCalendarOwnerRead({...shared,snapshot:input.daySnapshot});
 if(planned.status!=='ready'||days.status!=='ready')
  return unavailable('incomplete_or_wrong_owner_read');
 if(input.plannedSnapshot.snapshotVersion!==input.daySnapshot.snapshotVersion)
  return unavailable('snapshot_versions_disagree');
 const planIds=new Set<string>();
 for(const row of planned.records){
  if(!row||!row.id?.trim()||planIds.has(row.id)||
     row.ownerId!==input.expectedOwnerId||row.planRevisionId!==input.activePlanRevisionId||
     row.athleteLocalDate<input.startDate||row.athleteLocalDate>endDate||
     !['planned','missed','rest','recovery','cancelled'].includes(row.state))
    return unavailable('stale_or_invalid_planned_session');
  planIds.add(row.id);
 }
 const dateSet=new Set<string>(),states:Record<string,'planned'|'rest'|'recovery'|'unavailable'|'race'|'review_required'>={};
 for(const day of days.records){
  if(!day||!day.id?.trim()||dateSet.has(day.athleteLocalDate)||
     day.ownerId!==input.expectedOwnerId||day.planRevisionId!==input.activePlanRevisionId||
     day.athleteLocalDate<input.startDate||day.athleteLocalDate>endDate||
     !['planned','rest','recovery','unavailable','race','review_required'].includes(day.dayState))
   return unavailable('stale_or_invalid_plan_day');
  dateSet.add(day.athleteLocalDate);
  states[day.athleteLocalDate]=day.dayState;
 }
 if(!dateSet.has(input.startDate)||!dateSet.has(endDate))
  return unavailable('missing_season_day_coverage');
 const eventIds=new Set(events.map(e=>e.id));
 if(input.eventBindings.length!==eventIds.size)
  return unavailable('missing_or_extra_event_binding');
 const linkedEvents=new Set<string>(),linkedSessions=new Set<string>();
 for(const binding of input.eventBindings){
  if(!binding||!eventIds.has(binding.eventId)||linkedEvents.has(binding.eventId)||
     !binding.sessionId?.trim()||linkedSessions.has(binding.sessionId)||
     binding.planRevisionId!==input.activePlanRevisionId)
   return unavailable('invalid_event_binding');
  linkedEvents.add(binding.eventId);linkedSessions.add(binding.sessionId);
  const event=events.find(e=>e.id===binding.eventId)!;
  const matches=planned.records.filter(row=>row.id===binding.sessionId);
  // A calendar PlannedCalendarItem lacks a 'competition' flag; this bridge can
  // verify the exact identity/date, but NOT assert competition classification.
  // A separate canonical event-session owner must certify that fact before apply.
  if(matches.length!==1||matches[0].athleteLocalDate!==event.date||
     matches[0].state==='cancelled'||matches[0].state==='rest'||matches[0].state==='recovery'||
     matches[0].sport!==event.sport)
   return unavailable('event_session_conflicts_with_calendar');
  if(states[event.date]!=='race')
   return unavailable('event_day_not_certified');
 }
 // Every day must exist in the accepted owner day-state window. Missing days
 // cannot be interpreted as rest or silently filled with fictional workouts.
 let proposal:SeasonPlanDraft;
 try{
  proposal=buildMultiEventSeasonPlan({startDate:input.startDate,events:[...events],dayStates:states});
 }catch{return unavailable('season_calendar_invalid');}
 if(proposal.days.some(day=>!dateSet.has(day.date)||day.state==='review_required'))
  return unavailable('unclassified_or_missing_season_day');
 return {status:proposal.status,reason:null,proposal,
  planRevisionId:input.activePlanRevisionId,snapshotVersion:input.plannedSnapshot.snapshotVersion};
}
