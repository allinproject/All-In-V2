/**
 * V2 Training plan lifecycle: complete race horizon and missed-session reflow.
 * These functions create reviewable calendar/proposal data only. Training's
 * canonical plan writer remains the only place that can accept/persist changes.
 */
import type {TrainingDay,TrainingSessionIntent} from './trainingPlanSynthesis.ts';
const DAY_MS=86400000;
const dayNames:TrainingDay[]=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
export type RacePlanCalendarDay={date:string;day:TrainingDay;weekStart:string;weekNumber:number;phase:string;isRaceDay:boolean};
export type RacePlanCalendar={startDate:string;raceDate:string;totalDays:number;totalWeeks:number;days:RacePlanCalendarDay[]};
function validDate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value+'T12:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function shiftDate(value:string,days:number):string{
 return new Date(Date.parse(value+'T12:00:00Z')+days*DAY_MS).toISOString().slice(0,10);
}
function mondayOf(value:string):string{
 const d=new Date(value+'T12:00:00Z');
 const offset=(d.getUTCDay()+6)%7;
 return shiftDate(value,-offset);
}
function dateDiff(a:string,b:string):number{return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/DAY_MS)}
/** Inclusive every-day calendar. User-selected start date and exact race date are both included. */
export function buildRacePlanCalendar(input:{
 startDate:string;
 raceDate:string;
 phaseByWeekStart?:Record<string,string>;
 maxWeeks?:number;
}):RacePlanCalendar{
 const {startDate,raceDate}=input;
 if(!validDate(startDate)||!validDate(raceDate)||raceDate<startDate)throw new Error('Choose a valid training start date on or before race day.');
 const totalDays=dateDiff(startDate,raceDate)+1;
 const totalWeeks=Math.ceil(totalDays/7);
 const max=Math.max(1,Math.min(260,Math.floor(input.maxWeeks??260)));
 if(totalWeeks<2)throw new Error('A race plan needs at least two calendar weeks; review the race date or use a short-horizon plan.');
 if(totalWeeks>max)throw new Error('The selected race horizon exceeds the supported planning window.');
 const days:RacePlanCalendarDay[]=Array.from({length:totalDays},(_,offset)=>{
  const date=shiftDate(startDate,offset),weekStart=mondayOf(date),weekNumber=Math.floor(offset/7)+1;
  return{date,day:dayNames[(new Date(date+'T12:00:00Z').getUTCDay()+6)%7],weekStart,weekNumber,phase:input.phaseByWeekStart?.[weekStart]??'review_required',isRaceDay:date===raceDate};
 });
 if(days[days.length-1]?.date!==raceDate||days.filter(d=>d.isRaceDay).length!==1)throw new Error('Calendar must include the race date exactly once as its final day.');
 return{startDate,raceDate,totalDays,totalWeeks,days};
}
export type DatedTrainingSession={
 id:string;
 date:string;
 intent:TrainingSessionIntent;
 status:'planned'|'completed'|'skipped'|'cancelled';
};
export type MissedSessionReason='schedule_conflict'|'gym_unavailable'|'fatigue'|'soreness'|'illness_or_pain'|'weather'|'other';
export type RemainingPlanProposal={
 version:1;
 missedSessionId:string;
 missedSessionDate:string;
 reason:MissedSessionReason;
 sessions:DatedTrainingSession[];
 recommendations:string[];
 issues:Array<{code:'MISSED_SESSION_NOT_FOUND'|'DATE_INVALID'|'PAST_SESSION_MUTATION'|'KEY_SESSION_CONFLICT'|'RACE_DATE_PROTECTED';severity:'blocking'|'review';sessionIds:string[];message:string}>;
 status:'review_required'|'blocked';
 invariants:{missedWorkNotAutomaticallyRescheduled:true;completedHistoryPreserved:true;raceDayPreserved:true;requiresAthleteApproval:true};
};
/**
 * Mark an explicitly missed session as skipped and generate a future-only
 * review proposal. Never copy it to another date or mutate completed history.
 */
export function adaptRemainingPlanAfterMiss(input:{
 today:string;
 missedSessionId:string;
 reason:MissedSessionReason;
 sessions:DatedTrainingSession[];
 raceDate:string;
 newlyUnavailableDates?:string[];
}):RemainingPlanProposal{
 if(!validDate(input.today)||!validDate(input.raceDate)||input.raceDate<input.today)throw new Error('Valid athlete-local today and race dates are required.');
 if(!Array.isArray(input.sessions)||!Array.isArray(input.newlyUnavailableDates??[]))throw new Error('Current plan sessions and availability are required.');
 const issues:RemainingPlanProposal['issues']=[];
 const index=input.sessions.findIndex(s=>s.id===input.missedSessionId);
 if(index<0){
  issues.push({code:'MISSED_SESSION_NOT_FOUND',severity:'blocking',sessionIds:[input.missedSessionId],message:'The reported missed session is not in the current plan revision.'});
  return{version:1,missedSessionId:input.missedSessionId,missedSessionDate:'',reason:input.reason,sessions:input.sessions,recommendations:['Refresh the current Training plan; do not invent a replacement session.'],issues,status:'blocked',invariants:{missedWorkNotAutomaticallyRescheduled:true,completedHistoryPreserved:true,raceDayPreserved:true,requiresAthleteApproval:true}};
 }
 const target=input.sessions[index];
 if(!validDate(target.date)){
  issues.push({code:'DATE_INVALID',severity:'blocking',sessionIds:[target.id],message:'The missed session has an invalid local date.'});
  return{version:1,missedSessionId:target.id,missedSessionDate:target.date,reason:input.reason,sessions:input.sessions, recommendations:['Refresh the plan before proposing a change.'],issues,status:'blocked',invariants:{missedWorkNotAutomaticallyRescheduled:true,completedHistoryPreserved:true,raceDayPreserved:true,requiresAthleteApproval:true}};
 }
 if(target.status==='completed'){
  issues.push({code:'PAST_SESSION_MUTATION',severity:'blocking',sessionIds:[target.id],message:'A completed session cannot be reclassified as missed.'});
  return{version:1,missedSessionId:target.id,missedSessionDate:target.date,reason:input.reason,sessions:input.sessions,recommendations:['Preserve the completed activity and refresh the plan.'],issues,status:'blocked',invariants:{missedWorkNotAutomaticallyRescheduled:true,completedHistoryPreserved:true,raceDayPreserved:true,requiresAthleteApproval:true}};
 }
 if(target.date>input.today){
  issues.push({code:'PAST_SESSION_MUTATION',severity:'blocking',sessionIds:[target.id],message:'A future planned session cannot be marked skipped as though it already happened.'});
  return{version:1,missedSessionId:target.id,missedSessionDate:target.date,reason:input.reason,sessions:input.sessions,recommendations:['Update availability or preview a future schedule change instead.'],issues,status:'blocked',invariants:{missedWorkNotAutomaticallyRescheduled:true,completedHistoryPreserved:true,raceDayPreserved:true,requiresAthleteApproval:true}};
 }
 if(target.status==='skipped'||target.status==='cancelled'){
  return{version:1,missedSessionId:target.id,missedSessionDate:target.date,reason:input.reason,sessions:input.sessions,recommendations:['This session is already marked '+target.status+'. Do not create a duplicate make-up workout.'],issues,status:'review_required',invariants:{missedWorkNotAutomaticallyRescheduled:true,completedHistoryPreserved:true,raceDayPreserved:true,requiresAthleteApproval:true}};
 }
 const sessions=input.sessions.map((s,i)=>i===index?{...s,status:'skipped' as const}:s);
 const unavailable=new Set(input.newlyUnavailableDates??[]);
 const future=sessions.filter(s=>s.date>input.today&&s.status==='planned');
 for(const s of future){
  if(!validDate(s.date)){issues.push({code:'DATE_INVALID',severity:'blocking',sessionIds:[s.id],message:'A future session has an invalid date.'});continue;}
  if(unavailable.has(s.date))issues.push({code:'KEY_SESSION_CONFLICT',severity:s.intent.priority==='competition'||s.intent.priority==='key'?'blocking':'review',sessionIds:[s.id],message:'A planned session conflicts with newly reported unavailability; review the remaining plan.'});
  if(s.intent.priority==='competition'&&s.date===input.raceDate&&s.status!=='planned')issues.push({code:'RACE_DATE_PROTECTED',severity:'blocking',sessionIds:[s.id],message:'The race-day event identity must remain protected.'});
 }
 const recommendations:string[]=[
  'Record the missed session as skipped; do not move the same workout to tomorrow or stack it onto another hard day.',
  'Re-evaluate every remaining planned session through race day against current availability, recent completed work, fatigue and the next key session.',
  'Preserve the primary goal and race-specific key sessions where safe; reduce optional/supporting work before increasing load elsewhere.',
 ];
 if(input.reason==='fatigue'||input.reason==='soreness'||input.reason==='illness_or_pain')recommendations.push('Reassess recent load and recovery. A pain/illness concern requires the appropriate safety/return-to-training pathway before proposing a replacement.');
 if(input.reason==='schedule_conflict'||input.reason==='gym_unavailable'||input.reason==='weather')recommendations.push('Treat this as a missed opportunity, not lost fitness. Change the remaining calendar only where the actual availability or purpose conflict requires it.');
 return{version:1,missedSessionId:target.id,missedSessionDate:target.date,reason:input.reason,sessions,recommendations,issues,status:issues.some(i=>i.severity==='blocking')?'blocked':'review_required',invariants:{missedWorkNotAutomaticallyRescheduled:true,completedHistoryPreserved:true,raceDayPreserved:true,requiresAthleteApproval:true}};
}
