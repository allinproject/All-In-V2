/**
 * ALL-231: one coordinated multi-event season, preserving the existing
 * Training lifecycle as canonical. This module never writes accepted plans.
 */
import {buildRacePlanCalendar,adaptRemainingPlanAfterMiss,type RacePlanDayState,type RacePlanCalendarDay} from './trainingPlanLifecycle.ts';

export type EventPriority='A'|'B'|'C';
export type SeasonEvent={id:string;date:string;name:string;sport:string;priority:EventPriority;demand:'endurance'|'strength'|'mixed'|'unknown'};
export type SeasonIssue={code:'DUPLICATE_ID'|'DATE_CONFLICT'|'MULTIPLE_A'|'RECOVERY_REVIEW'|'DEMAND_UNKNOWN'|'SHORT_HORIZON';severity:'blocking'|'review';eventIds:string[];message:string};
export type SeasonDay=RacePlanCalendarDay&{eventIds:string[]};
export type SeasonPlanDraft={version:1;startDate:string;endDate:string;events:SeasonEvent[];days:SeasonDay[];issues:SeasonIssue[];status:'blocked'|'review_required';recommendations:string[];invariants:{noAutomaticWrite:true;allEventsRetained:true;athleteChoosesPriorities:true}};
const validDate=(v:string)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const daysBetween=(a:string,b:string)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
const issue=(code:SeasonIssue['code'],severity:SeasonIssue['severity'],eventIds:string[],message:string):SeasonIssue=>({code,severity,eventIds,message});
export function buildMultiEventSeasonPlan(input:{startDate:string;events:SeasonEvent[];dayStates?:Record<string,RacePlanDayState>;phaseByWeekStart?:Record<string,string>;maxWeeks?:number}):SeasonPlanDraft{
 if(!input||!Array.isArray(input.events)||input.events.length<1||input.events.length>50)throw Error('Choose one to fifty confirmed dated events.');
 const events=input.events.map(e=>({...e})).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 if(events.some(e=>!e||!e.id?.trim()||!e.name?.trim()||!e.sport?.trim()||!validDate(e.date)||!['A','B','C'].includes(e.priority)||!['endurance','strength','mixed','unknown'].includes(e.demand)))throw Error('Each event needs valid identity, date, sport, priority and demands.');
 const endDate=events.at(-1)!.date;
 const base=buildRacePlanCalendar({startDate:input.startDate,raceDate:endDate,maxWeeks:input.maxWeeks,phaseByWeekStart:input.phaseByWeekStart});
 const issues:SeasonIssue[]=[];const ids=new Set<string>(),byDate=new Map<string,string[]>();
 for(const e of events){
  if(e.date<input.startDate)throw Error('Event cannot precede selected training start.');
  if(ids.has(e.id))issues.push(issue('DUPLICATE_ID','blocking',[e.id],'An event identity is repeated.'));
  ids.add(e.id);byDate.set(e.date,[...(byDate.get(e.date)??[]),e.id]);
  if(e.demand==='unknown')issues.push(issue('DEMAND_UNKNOWN','review',[e.id],'Confirm event demands before prescribing event-specific sessions.'));
 }
 for(const [date,eventIds] of byDate)if(eventIds.length>1)issues.push(issue('DATE_CONFLICT','blocking',eventIds,'Multiple events share '+date+'; review feasibility.'));
 const primary=events.filter(e=>e.priority==='A');
 if(primary.length>1)issues.push(issue('MULTIPLE_A','review',primary.map(e=>e.id),'Multiple A events require a multi-peak plan and recovery review.'));
 if(daysBetween(input.startDate,events[0].date)<14)issues.push(issue('SHORT_HORIZON','review',[events[0].id],'First event has a short preparation window; do not invent a full training build.'));
 for(let i=1;i<events.length;i++){
  const a=events[i-1],b=events[i],gap=daysBetween(a.date,b.date);
  if(gap<21&&[a.demand,b.demand].some(x=>x==='endurance'||x==='mixed'))issues.push(issue('RECOVERY_REVIEW','review',[a.id,b.id],`Events are ${gap} days apart; reassess recovery and effort priorities, never guarantee both peaks.`));
 }
 const days:SeasonDay[]=base.days.map(day=>{
  const eventIds=byDate.get(day.date)??[],userState=input.dayStates?.[day.date];
  if(!eventIds.length&&userState==='race')throw Error('Non-event date cannot be a race.');
  if(eventIds.length&&userState!==undefined&&userState!=='race')throw Error('Event date cannot be overwritten by rest/training.');
  return {...day,eventIds,isRaceDay:eventIds.length>0,state:eventIds.length?'race':userState??'review_required'};
 });
 return {version:1,startDate:input.startDate,endDate,events,days,issues,status:issues.some(i=>i.severity==='blocking')?'blocked':'review_required',
  recommendations:['Coordinate all events in one calendar; do not stack separate plans.','Preserve A/B/C priorities selected by the athlete and discuss conflicts before applying.','Consider event-specific taper, recovery and multi-sport load without inventing training doses.','Reassess later events after each completed event using verified athlete history; all plan changes require review.'],
  invariants:{noAutomaticWrite:true,allEventsRetained:true,athleteChoosesPriorities:true}};
}
export function assertMultiEventSeasonAssigned(plan:SeasonPlanDraft):void{
 if(!plan||plan.status==='blocked'||!plan.days.length||plan.days[0].date!==plan.startDate||plan.days.at(-1)?.date!==plan.endDate||plan.days.length!==daysBetween(plan.startDate,plan.endDate)+1)throw Error('Complete, unblocked season is required.');
 const dated=new Map<string,string[]>();
 for(const e of plan.events)dated.set(e.date,[...(dated.get(e.date)??[]),e.id]);
 for(let i=0;i<plan.days.length;i++){
  const day=plan.days[i],expectedDate=new Date(Date.parse(plan.startDate+'T12:00:00Z')+i*86400000).toISOString().slice(0,10),expected=dated.get(expectedDate)??[];
  if(day.date!==expectedDate||day.state==='review_required'||!['planned','rest','recovery','unavailable','race'].includes(day.state)||day.isRaceDay!==(expected.length>0)||(expected.length>0&&day.state!=='race')||(expected.length===0&&day.state==='race')||day.eventIds.length!==expected.length||!expected.every(id=>day.eventIds.includes(id)))throw Error('Every season date needs the right state and canonical event identity.');
 }
}

/**
 * Reflow after a missed workout must preserve EVERY scheduled event, not just
 * the final race. Bind event identities to canonical Training session IDs.
 * A preview is returned; neither athlete history nor accepted plan is written.
 */
export function reviewMultiEventMissedSession(input:{
 today:string;missedSessionId:string;
 reason:import('./trainingPlanLifecycle.ts').MissedSessionReason;
 events:SeasonEvent[];
 sessions:import('./trainingPlanLifecycle.ts').DatedTrainingSession[];
 eventSessionIds:Record<string,string>;
 newlyUnavailableDates?:string[];
}):{
 status:'blocked'|'review_required';
 issues:Array<{code:'EVENT_BINDING_MISSING'|'EVENT_DATE_CHANGED'|'EVENT_SESSION_MISSED'|'EVENT_UNAVAILABLE';eventIds:string[];message:string}>;
 proposal:import('./trainingPlanLifecycle.ts').RemainingPlanProposal|null;
}{
 const issues:Array<{code:'EVENT_BINDING_MISSING'|'EVENT_DATE_CHANGED'|'EVENT_SESSION_MISSED'|'EVENT_UNAVAILABLE';eventIds:string[];message:string}>=[];
 if(!Array.isArray(input.events)||!input.events.length||!Array.isArray(input.sessions)||
   !validDate(input.today)||!input.eventSessionIds||typeof input.eventSessionIds!=='object')
  throw Error('Canonical event and Training data are required for reflow.');
 const ids=new Set<string>(),sessionIds=new Set<string>();
 for(const event of input.events){
  if(!event?.id?.trim()||!validDate(event.date)||ids.has(event.id))throw Error('Distinct dated event identities required.');
  ids.add(event.id);
  const sessionId=input.eventSessionIds[event.id];
  if(typeof sessionId!=='string'||!sessionId.trim()||sessionIds.has(sessionId)){
   issues.push({code:'EVENT_BINDING_MISSING',eventIds:[event.id],message:'Missing unique canonical Training session binding for event.'});
   continue;
  }
  sessionIds.add(sessionId);
  const matches=input.sessions.filter(s=>s.id===sessionId);
  if(matches.length!==1||matches[0].intent?.priority!=='competition'){
   issues.push({code:'EVENT_BINDING_MISSING',eventIds:[event.id],message:'Expected exactly one canonical competition session.'});
  }else if(matches[0].date!==event.date){
   issues.push({code:'EVENT_DATE_CHANGED',eventIds:[event.id],message:'Competition date differs from saved event date.'});
  }
  if(sessionId===input.missedSessionId)
   issues.push({code:'EVENT_SESSION_MISSED',eventIds:[event.id],message:'A scheduled event cannot be marked missed as an ordinary training session; review the event first.'});
  if((input.newlyUnavailableDates??[]).includes(event.date))
   issues.push({code:'EVENT_UNAVAILABLE',eventIds:[event.id],message:'Reported unavailability conflicts with a scheduled event. Require explicit event review.'});
 }
 if(issues.length)return{status:'blocked',issues,proposal:null};
 const last=[...input.events].sort((a,b)=>b.date.localeCompare(a.date))[0];
 const proposal=adaptRemainingPlanAfterMiss({
  today:input.today,missedSessionId:input.missedSessionId,
  reason:input.reason,sessions:input.sessions,raceDate:last.date,
  newlyUnavailableDates:input.newlyUnavailableDates
 });
 return{status:proposal.status,issues,proposal};
}
