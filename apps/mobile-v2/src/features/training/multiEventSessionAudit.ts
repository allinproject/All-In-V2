/**
 * ALL-231: audit existing accepted sessions against reviewed A/B/C season
 * windows. Certified snapshot only; NEVER reschedule, prescribe, or apply.
 */
import {certifyCalendarOwnerRead,type OwnerCalendarWindowSnapshot} from './calendarOwnerReadCertification.ts';
import {previewCertifiedSeasonPhases} from './multiEventPhaseOwnerPreview.ts';
import type {DatedTrainingSession} from './trainingPlanLifecycle.ts';

type SeasonInput=Parameters<typeof previewCertifiedSeasonPhases>[0];
export type OwnerDatedSession=DatedTrainingSession&{ownerId:string;planRevisionId:string};
export type SeasonSessionConflict={
 code:'SESSION_ON_EVENT_DAY'|'KEY_WORK_DURING_RECOVERY'|
 'HARD_WORK_DURING_TAPER'|'UNKNOWN_INTENSITY_IN_WINDOW'|'DUPLICATE_SESSION_ID';
 severity:'blocking'|'review';sessionIds:string[];eventIds:string[];date:string;message:string;
};
export type SeasonSessionAudit=
 | {status:'unavailable';reason:string;issues:[];sessionCount:0}
 | {status:'blocked'|'review_required';reason:null;issues:SeasonSessionConflict[];
    sessionCount:number;ownerId:string;planRevisionId:string;snapshotVersion:string;
    requiresAthleteApproval:true;noAutomaticSessionMoves:true};
export function auditCertifiedSeasonSessions(input:{
 phase:SeasonInput;
 acceptedSessionSnapshot:OwnerCalendarWindowSnapshot<OwnerDatedSession>|null;
}):SeasonSessionAudit{
 const unavailable=(reason:string):SeasonSessionAudit=>({status:'unavailable',reason,issues:[],sessionCount:0});
 if(!input?.acceptedSessionSnapshot)return unavailable('missing_canonical_sessions');
 const phase=previewCertifiedSeasonPhases(input.phase);
 if(phase.status==='unavailable')return unavailable('uncertified_season_or_phase');
 const args=input.phase.ownerSeason;
 const sessions=certifyCalendarOwnerRead({
  expectedOwnerId:args.expectedOwnerId,authenticatedOwnerId:args.authenticatedOwnerId,
  activeSessionGeneration:args.activeSessionGeneration,accessGateReady:args.accessGateReady,
  requestedFromDate:phase.draft.startDate,requestedThroughDate:phase.draft.endDate,
  snapshot:input.acceptedSessionSnapshot
 });
 if(sessions.status!=='ready'||input.acceptedSessionSnapshot.snapshotVersion!==phase.snapshotVersion)
  return unavailable('incomplete_stale_or_wrong_owner_session_read');
 const byDay=new Map<string,typeof phase.phases.annotations>();
 for(const p of phase.phases.annotations){
  const hits=byDay.get(p.date)??[];hits.push(p);byDay.set(p.date,hits);
 }
 const eventSessionIds=new Set(args.competitionSnapshot?.records.map(r=>r.sessionId)??[]);
 const issues:SeasonSessionConflict[]=[];
 const seen=new Set<string>();
 for(const session of sessions.records){
  if(!session||typeof session.id!=='string'||!session.id.trim()||
     !session.ownerId||session.ownerId!==args.expectedOwnerId||
     session.planRevisionId!==phase.planRevisionId||
     !session.date||session.date<phase.draft.startDate||session.date>phase.draft.endDate||
     !['planned','completed','skipped','cancelled'].includes(session.status)||
     !session.intent||!['competition','key','supporting','optional'].includes(session.intent.priority)||
     !['easy','moderate','hard','unknown'].includes(session.intent.intensity))
   return unavailable('invalid_or_foreign_accepted_session');
  if(seen.has(session.id)){
   issues.push({code:'DUPLICATE_SESSION_ID',severity:'blocking',sessionIds:[session.id],eventIds:[],
    date:session.date,message:'Canonical Training session identity repeats; refresh the accepted revision.'});
   continue;
  }
  seen.add(session.id);
  if(session.status!=='planned'||eventSessionIds.has(session.id))continue;
  const annotations=byDay.get(session.date)??[];
  if(!annotations.length)continue;
  const races=annotations.filter(x=>x.kind==='event');
  if(races.length){
   issues.push({code:'SESSION_ON_EVENT_DAY',severity:'blocking',sessionIds:[session.id],
    eventIds:races.map(x=>x.eventId),date:session.date,
    message:'An additional planned workout shares an event day; athlete review is required.'});
  }
  const recovering=annotations.filter(x=>x.kind==='post_event_recovery_review');
  const taper=annotations.filter(x=>x.kind==='taper_review');
  if(recovering.length&&(session.intent.priority==='key'||session.intent.intensity==='hard')){
   issues.push({code:'KEY_WORK_DURING_RECOVERY',severity:'review',sessionIds:[session.id],
    eventIds:[...new Set(recovering.map(x=>x.eventId))],date:session.date,
    message:'A hard or key session falls inside post-event recovery review; do not infer readiness.'});
  }
  if(taper.length&&session.intent.intensity==='hard'){
   issues.push({code:'HARD_WORK_DURING_TAPER',severity:'review',sessionIds:[session.id],
    eventIds:[...new Set(taper.map(x=>x.eventId))],date:session.date,
    message:'A hard session falls inside an event taper window; assess purpose and priority before changing it.'});
  }
  if((taper.length||recovering.length)&&session.intent.intensity==='unknown'){
   issues.push({code:'UNKNOWN_INTENSITY_IN_WINDOW',severity:'review',sessionIds:[session.id],
    eventIds:[...new Set([...taper,...recovering].map(x=>x.eventId))],date:session.date,
    message:'The intensity is unknown inside a protected phase; request canonical workout detail.'});
  }
 }
 return{status:issues.some(i=>i.severity==='blocking')?'blocked':'review_required',reason:null,
  issues,sessionCount:sessions.records.length,ownerId:args.expectedOwnerId,
  planRevisionId:phase.planRevisionId,snapshotVersion:phase.snapshotVersion,
  requiresAthleteApproval:true,noAutomaticSessionMoves:true};
}
