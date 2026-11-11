/**
 * ALL-231: post-event season reassessment, based only on complete canonical
 * Training owner reads. Does not revise accepted sessions or infer recovery.
 */
import {certifyCalendarOwnerRead,type OwnerCalendarWindowSnapshot} from './calendarOwnerReadCertification.ts';
import {proposeSeasonFromVerifiedTraining} from './multiEventOwnerBridge.ts';
import type {CompletedCalendarItem} from './trainingCalendarReadModel.ts';

type OwnerSeasonInput=Parameters<typeof proposeSeasonFromVerifiedTraining>[0];
export type PostEventSeasonReview=
 | {status:'unavailable'|'awaiting_result';reason:string;remainingEventIds:string[];recommendations:[]}
 | {status:'review_required';reason:null;completedEventId:string;
    resultId:string;planRevisionId:string;remainingEventIds:string[];recommendations:string[]};

export function proposePostEventSeasonReview(input:{
 ownerSeason:OwnerSeasonInput;
 currentAcceptedPlanRevisionId:string;
 completedEventId:string;
 athleteLocalToday:string;
 completedSnapshot:OwnerCalendarWindowSnapshot<CompletedCalendarItem>|null;
}):PostEventSeasonReview{
 const unavailable=(reason:string,status:'unavailable'|'awaiting_result'='unavailable'):PostEventSeasonReview=>
  ({status,reason,remainingEventIds:[],recommendations:[]});
 if(!input||!input.ownerSeason||!input.completedSnapshot||
   !input.completedEventId?.trim()||!input.currentAcceptedPlanRevisionId?.trim()||
   typeof input.athleteLocalToday!=='string')return unavailable('missing_canonical_evidence');
 const season=proposeSeasonFromVerifiedTraining(input.ownerSeason);
 if(season.status==='unavailable'||season.status==='blocked')
  return unavailable('season_not_owner_certified');
 if(input.currentAcceptedPlanRevisionId!==season.planRevisionId)
  return unavailable('accepted_training_revision_changed');
 const event=season.proposal.events.find(e=>e.id===input.completedEventId);
 if(!event)return unavailable('event_not_in_current_season');
 const today=input.athleteLocalToday;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(today+'T12:00:00Z'))||
    new Date(today+'T12:00:00Z').toISOString().slice(0,10)!==today)
  return unavailable('invalid_athlete_local_date');
 if(event.date>today)return unavailable('event_not_yet_occurred');
 const bindings=input.ownerSeason.competitionSnapshot?.records??[];
 const binding=bindings.find(b=>b.eventId===event.id);
 if(!binding)return unavailable('event_competition_binding_missing');
 const completed=certifyCalendarOwnerRead({
  expectedOwnerId:input.ownerSeason.expectedOwnerId,
  authenticatedOwnerId:input.ownerSeason.authenticatedOwnerId,
  activeSessionGeneration:input.ownerSeason.activeSessionGeneration,
  accessGateReady:input.ownerSeason.accessGateReady,
  requestedFromDate:event.date,requestedThroughDate:event.date,
  snapshot:input.completedSnapshot
 });
 if(completed.status!=='ready')return unavailable('completion_owner_window_unavailable');
 const seen=new Set<string>();
 for(const row of completed.records){
  if(!row||!row.id?.trim()||seen.has(row.id)||
     row.ownerId!==input.ownerSeason.expectedOwnerId||
     row.athleteLocalDate<input.completedSnapshot.fromDate||
     row.athleteLocalDate>input.completedSnapshot.throughDate||
     !['race_result','recorded','device_import','manual_entry'].includes(row.source))
   return unavailable('completion_snapshot_invalid');
  seen.add(row.id);
 }
 const results=completed.records.filter(r=>
  r.plannedSessionId===binding.sessionId&&r.athleteLocalDate===event.date&&
  r.sport===event.sport&&r.source==='race_result');
 if(results.length===0)return unavailable('verified_race_result_not_available','awaiting_result');
 if(results.length!==1)return unavailable('ambiguous_race_result');
 const later=season.proposal.events.filter(e=>e.date>event.date).map(e=>e.id);
 return{status:'review_required',reason:null,completedEventId:event.id,
  resultId:results[0].id,planRevisionId:season.planRevisionId,
  remainingEventIds:later,
  recommendations:[
   'Review race effort, recovery, soreness and restrictions before adjusting later events.',
   'Compare subsequent sport-specific key sessions to verified completed load; do not add make-up volume.',
   'Preserve all later event dates and athlete-selected priorities unless the athlete explicitly changes them.',
   'Preview a revised accepted Training plan with the current revision; never apply changes automatically.'
  ]};
}
