/**
 * ALL-231: evidence-scoped phase windows for a coordinated multi-event season.
 * Never prescribes loads, fabricates taper/recovery durations, or mutates
 * accepted Training day/session states. Windows are REVIEW annotations only.
 */
import type {SeasonPlanDraft,SeasonEvent} from './multiEventSeasonPlan.ts';

export type EventPhaseDecision={
 eventId:string;
 /** Independent requested intent; a C event does not silently become a peak. */
 effort:'peak'|'supported'|'practice';
 /** Null means evidence is insufficient; never infer a number from A/B/C. */
 taperDays:number|null;
 recoveryReviewDays:number|null;
 source:'athlete_confirmed'|'coach_evidence_reviewed';
 evidenceRefs:string[];
};
export type PhaseAnnotation={
 date:string;
 kind:'taper_review'|'event'|'post_event_recovery_review';
 eventId:string;priority:SeasonEvent['priority'];
};
export type MultiEventPhaseIssue={
 code:'MISSING_PHASE_EVIDENCE'|'UNSUPPORTED_PEAK'|'OVERLAPPING_TAPER_RECOVERY'|
  'EVENT_IN_RECOVERY_WINDOW'|'EVENT_IN_OTHER_TAPER_WINDOW'|'TAPER_BEFORE_CALENDAR'|
  'PHASE_CONFLICTS_WITH_CANONICAL_DAY'|'UNKNOWN_EVENT_DEMAND';
 severity:'blocking'|'review';
 eventIds:string[];date:string|null;message:string;
};
export type MultiEventPhaseReview={
 status:'blocked'|'review_required';
 annotations:PhaseAnnotation[];
 issues:MultiEventPhaseIssue[];
 uncoveredPostSeason: Array<{eventId:string;throughDate:string}>;
 invariants:{noAutomaticPlanWrite:true;noInventedDose:true;allEventDatesPreserved:true};
};

const DAY=86400000;
function move(date:string,days:number):string{
 return new Date(Date.parse(date+'T12:00:00Z')+days*DAY).toISOString().slice(0,10);
}
const between=(a:string,b:string):number=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/DAY);
const error=(code:MultiEventPhaseIssue['code'],severity:MultiEventPhaseIssue['severity'],eventIds:string[],date:string|null,message:string):MultiEventPhaseIssue=>({code,severity,eventIds,date,message});
export function reviewMultiEventPhaseWindows(input:{
 season:SeasonPlanDraft;
 decisions:readonly EventPhaseDecision[];
}):MultiEventPhaseReview{
 const {season,decisions}=input??{};
 if(!season||!Array.isArray(season.events)||!Array.isArray(season.days)||
    !Array.isArray(decisions)||season.status==='blocked'||season.days.length<1)
   throw Error('Valid unblocked coordinated season and phase decisions required.');
 const events=new Map<string,SeasonEvent>();
 for(const event of season.events){
  if(!event?.id?.trim()||events.has(event.id))throw Error('Unique event identities are required.');
  events.set(event.id,event);
 }
 if(decisions.length!==events.size)throw Error('Every season event requires exactly one explicit phase decision.');
 const mapped=new Map<string,EventPhaseDecision>();
 for(const d of decisions){
  if(!d||!events.has(d.eventId)||mapped.has(d.eventId)||
     !['peak','supported','practice'].includes(d.effort)||
     !['athlete_confirmed','coach_evidence_reviewed'].includes(d.source)||
     !Array.isArray(d.evidenceRefs)||!d.evidenceRefs.every(x=>typeof x==='string'&&x.trim())||
     (d.source==='coach_evidence_reviewed'&&d.evidenceRefs.length===0)||
     (d.taperDays!==null&&(!Number.isSafeInteger(d.taperDays)||d.taperDays<0||d.taperDays>42))||
     (d.recoveryReviewDays!==null&&(!Number.isSafeInteger(d.recoveryReviewDays)||d.recoveryReviewDays<0||d.recoveryReviewDays>90)))
    throw Error('Phase decisions require distinct events, source evidence and valid optional days.');
  mapped.set(d.eventId,d);
 }
 const annotations:PhaseAnnotation[]=[];
 const issues:MultiEventPhaseIssue[]=[];
 const uncoveredPostSeason:MultiEventPhaseReview['uncoveredPostSeason']=[];
 const dateIndex=new Map(season.days.map(d=>[d.date,d]));
 if(dateIndex.size!==season.days.length)throw Error('Duplicate season dates are not safe to annotate.');
 const allDates=new Map<string,PhaseAnnotation[]>();
 function push(annotation:PhaseAnnotation){
  const values=allDates.get(annotation.date)??[];
  values.push(annotation);allDates.set(annotation.date,values);annotations.push(annotation);
 }
 for(const event of season.events){
  const d=mapped.get(event.id)!;
  if(event.demand==='unknown')issues.push(error('UNKNOWN_EVENT_DEMAND','review',[event.id],event.date,'Verify event duration and sport-specific demands before choosing phase windows.'));
  if(d.effort==='peak'&&d.taperDays===null)
   issues.push(error('MISSING_PHASE_EVIDENCE','review',[event.id],event.date,'Peak taper needs sourced athlete-specific review; no default number was applied.'));
  if(d.recoveryReviewDays===null)
   issues.push(error('MISSING_PHASE_EVIDENCE','review',[event.id],event.date,'Post-event recovery duration is unknown; do not assume immediate return to full training.'));
  if(d.effort==='peak'&&event.priority==='C')
   issues.push(error('UNSUPPORTED_PEAK','review',[event.id],event.date,'An athlete-labeled C event was requested as a peak; confirm priority before taper changes.'));
  const atEvent=dateIndex.get(event.date);
  if(!atEvent||!atEvent.isRaceDay||!atEvent.eventIds.includes(event.id)||atEvent.state!=='race')
   throw Error('Season event date must remain an exact certified race state.');
  push({date:event.date,kind:'event',eventId:event.id,priority:event.priority});
  if(d.taperDays!==null&&d.effort!=='practice'){
   if(d.taperDays>between(season.startDate,event.date))
    issues.push(error('TAPER_BEFORE_CALENDAR','review',[event.id],season.startDate,
     'Requested taper extends before the selected training start; require an explicit short-horizon review.'));
   for(let offset=Math.min(d.taperDays,between(season.startDate,event.date));offset>0;offset--){
    const date=move(event.date,-offset);
    const day=dateIndex.get(date);
    if(!day)throw Error('Taper annotation outside season calendar.');
    if(day.state==='unavailable')issues.push(error('PHASE_CONFLICTS_WITH_CANONICAL_DAY','review',[event.id],date,'Taper window intersects unavailable day; do not fabricate a replacement workout.'));
    push({date,kind:'taper_review',eventId:event.id,priority:event.priority});
   }
  }
  if(d.recoveryReviewDays!==null){
   const postEnd=move(event.date,d.recoveryReviewDays);
   if(postEnd>season.endDate)uncoveredPostSeason.push({eventId:event.id,throughDate:postEnd});
   for(let offset=1;offset<=Math.min(d.recoveryReviewDays,between(event.date,season.endDate));offset++){
    const date=move(event.date,offset),day=dateIndex.get(date);
    if(!day)throw Error('Recovery annotation outside season calendar.');
    if(day.state==='unavailable')issues.push(error('PHASE_CONFLICTS_WITH_CANONICAL_DAY','review',[event.id],date,'Recovery review intersects an unavailable day; preserve canonical day state.'));
    push({date,kind:'post_event_recovery_review',eventId:event.id,priority:event.priority});
   }
  }
 }
 for(const [date,items] of allDates){
  const races=items.filter(x=>x.kind==='event'),recovery=items.filter(x=>x.kind==='post_event_recovery_review');
  const taper=items.filter(x=>x.kind==='taper_review');
  if(races.length&&taper.some(t=>races.some(r=>r.eventId!==t.eventId))){
   issues.push(error('EVENT_IN_OTHER_TAPER_WINDOW','review',
    [...new Set([...races,...taper].map(x=>x.eventId))],date,
    'An event falls during the taper review window for another event; ask whether it is a supported tune-up or a conflicting peak.'));
  }
  if(recovery.length&&(taper.length||races.length)){
   const ids=[...new Set([...recovery,...taper,...races].map(x=>x.eventId))];
   if(races.length)issues.push(error('EVENT_IN_RECOVERY_WINDOW','review',ids,date,'A subsequent event overlaps recovery review from a prior event; ask the athlete about effort and recovery.'));
   if(taper.length)issues.push(error('OVERLAPPING_TAPER_RECOVERY','review',ids,date,'A later taper overlaps recovery from another event; do not stack incompatible training demands.'));
  }
 }
 annotations.sort((a,b)=>a.date.localeCompare(b.date)||a.eventId.localeCompare(b.eventId)||a.kind.localeCompare(b.kind));
 return{status:issues.some(i=>i.severity==='blocking')?'blocked':'review_required',
   annotations,issues,uncoveredPostSeason,
   invariants:{noAutomaticPlanWrite:true,noInventedDose:true,allEventDatesPreserved:true}};
}
