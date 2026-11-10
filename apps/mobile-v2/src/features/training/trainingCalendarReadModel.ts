import { V2_ACTIVITY_SPORTS, type ActivitySport } from './activityEntryContract.ts';
import { validAthleteLocalDate } from './manualActivityDraft.ts';
import { type CalendarEvidence, type CalendarWorkoutMarker, monthDayMarkerSummary } from './calendarDayView.ts';

/**
 * ALL-246/243: pure presenter of TWO independent, canonical, owner-scoped reads.
 * No SQL ownership, no inferred missed sessions, no automatic plan-completion link.
 * Caller must provide verified, complete-scope reads from canonical owners.
 */
export type PlannedCalendarItem = {
  id: string;
  ownerId: string;
  athleteLocalDate: string;
  sport: ActivitySport | 'rest' | 'recovery';
  state: 'planned' | 'missed' | 'rest' | 'recovery' | 'cancelled';
  planRevisionId: string;
};
export type CompletedCalendarItem = {
  id: string;
  ownerId: string;
  athleteLocalDate: string;
  sport: ActivitySport;
  source: 'manual_entry' | 'recorded' | 'device_import' | 'race_result';
  plannedSessionId: string | null;
};
export type OwnerCalendarRead<T> =
  | { status: 'unavailable' | 'loading' | 'error'; records?: never }
  | { status: 'ready'; ownerId: string; fromDate: string; throughDate: string; records: readonly T[] };
export type CombinedCalendarResult = {
  planned: CalendarEvidence<PlannedCalendarItem>;
  completed: CalendarEvidence<CompletedCalendarItem>;
  markers: CalendarEvidence<CalendarWorkoutMarker>;
  status: 'ready' | 'partial' | 'unavailable';
};

/** A verified empty result differs from an unverified or out-of-range result. */
function validatedRead<T extends {id:string;ownerId:string;athleteLocalDate:string}>(
  read: OwnerCalendarRead<T>,
  ownerId: string, fromDate: string, throughDate: string,
  validItem: (item:T)=>boolean,
): CalendarEvidence<T> {
  if (read.status !== 'ready') return { status: 'unavailable' };
  if (!ownerId || read.ownerId !== ownerId || !validAthleteLocalDate(read.fromDate)
    || !validAthleteLocalDate(read.throughDate) || read.fromDate > fromDate || read.throughDate < throughDate
    || !Array.isArray(read.records)) return { status: 'unavailable' };
  const ids=new Set<string>();
  for (const item of read.records) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)
      || item.ownerId !== ownerId || !validAthleteLocalDate(item.athleteLocalDate)
      || item.athleteLocalDate < read.fromDate || item.athleteLocalDate > read.throughDate
      || !validItem(item)) return { status: 'unavailable' };
    ids.add(item.id);
  }
  return { status:'ready', records:read.records.filter(item=>item.athleteLocalDate>=fromDate && item.athleteLocalDate<=throughDate) };
}
const isSport=(value:unknown):value is ActivitySport=>V2_ACTIVITY_SPORTS.some(s=>s===value);
export function combineCalendarReads(args:{
  ownerId:string;
  fromDate:string;
  throughDate:string;
  planned:OwnerCalendarRead<PlannedCalendarItem>;
  completed:OwnerCalendarRead<CompletedCalendarItem>;
}):CombinedCalendarResult {
  const {ownerId,fromDate,throughDate}=args;
  if (!ownerId || !validAthleteLocalDate(fromDate) || !validAthleteLocalDate(throughDate) || fromDate>throughDate) {
    return {planned:{status:'unavailable'},completed:{status:'unavailable'},markers:{status:'unavailable'},status:'unavailable'};
  }
  const planned=validatedRead(args.planned,ownerId,fromDate,throughDate,item=>
    typeof item.planRevisionId==='string'&&item.planRevisionId.trim().length>0
    && ['planned','missed','rest','recovery','cancelled'].includes(item.state)
    && (item.state==='rest'?item.sport==='rest':item.state==='recovery'?item.sport==='recovery':isSport(item.sport))
  );
  const candidateCompleted=validatedRead(args.completed,ownerId,fromDate,throughDate,item=>
    isSport(item.sport)&&['manual_entry','recorded','device_import','race_result'].includes(item.source)
    &&(item.plannedSessionId===null||(typeof item.plannedSessionId==='string'&&item.plannedSessionId.trim().length>0))
  );
  // A linked completion must not silently hide an unrelated sport, an earlier/later
  // scheduled day, or a second actual completion tied to the same plan session.
  // Cross-day links may be legitimate after rescheduling: display both dates until
  // the authoritative owner revises the planned date; never pretend they coincide.
  const knownPlanned=planned.status==='ready'?new Map(planned.records.map(p=>[p.id,p])):null;
  const seenLinked=new Set<string>();
  const invalidLinks=candidateCompleted.status==='ready'&&candidateCompleted.records.some(c=>{
    if(!c.plannedSessionId)return false;
    if(seenLinked.has(c.plannedSessionId))return true;
    seenLinked.add(c.plannedSessionId);
    const target=knownPlanned?.get(c.plannedSessionId);
    return Boolean(target && (target.sport!==c.sport || target.state==='rest'
      || target.state==='recovery'||target.state==='cancelled'));
  });
  const completed:CalendarEvidence<CompletedCalendarItem> = invalidLinks
    ? {status:'unavailable'} : candidateCompleted;
  // Do not claim complete month indicators if only one of the two sources loaded.
  // The same planned session, when linked to a completion, must not appear as both planned and completed.
  const markers:CalendarEvidence<CalendarWorkoutMarker> = planned.status==='ready' && completed.status==='ready'
    ? {status:'ready',records:(()=>{
        const linked=new Set(completed.records.filter(c=>{
          const match=c.plannedSessionId?knownPlanned?.get(c.plannedSessionId):undefined;
          return match?.athleteLocalDate===c.athleteLocalDate && match?.sport===c.sport;
        }).map(c=>c.plannedSessionId).filter((id):id is string=>Boolean(id)));
        return [
          ...planned.records.filter(p=>p.state!=='cancelled'&&!linked.has(p.id))
            .map(p=>({athleteLocalDate:p.athleteLocalDate,kind:p.sport,status:p.state} as CalendarWorkoutMarker)),
          ...completed.records.map(c=>({athleteLocalDate:c.athleteLocalDate,kind:c.sport,status:'completed' as const})),
        ];
      })()}
    : {status:'unavailable'};
  return {planned,completed,markers,status:planned.status==='ready'&&completed.status==='ready'?'ready'
    :planned.status==='ready'||completed.status==='ready'?'partial':'unavailable'};
}
export function indicatorsForCalendarDay(result:CombinedCalendarResult,day:string){
  return monthDayMarkerSummary(result.markers,day);
}
