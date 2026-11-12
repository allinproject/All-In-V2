/**
 * ALL-231/232/246: Coach's read-only projection of the SAME two canonical
 * calendar owners used by Training. Never derives missing sessions or writes.
 * Owner snapshots must be complete, generation-bound and revision-stamped.
 */
import { visibleCalendarReadRange } from './calendarDayView.ts';
import { certifyCalendarOwnerRead, type OwnerCalendarWindowSnapshot } from './calendarOwnerReadCertification.ts';
import { combineCalendarReads, type PlannedCalendarItem, type CompletedCalendarItem } from './trainingCalendarReadModel.ts';
import { prepareCoachCalendarContext, type CoachCalendarContextResult, type CoachCalendarSession } from './coachCalendarContext.ts';

export type CoachCertifiedCalendarInput = {
  expectedOwnerId: string;
  authenticatedOwnerId: string | null;
  activeSessionGeneration: number;
  accessGateReady: boolean;
  selectedDay: string;
  view: 'week' | 'month';
  plannedSnapshot: OwnerCalendarWindowSnapshot<PlannedCalendarItem> | null | undefined;
  completedSnapshot: OwnerCalendarWindowSnapshot<CompletedCalendarItem> | null | undefined;
};

export type CoachCertifiedCalendarResult =
  | {kind:'blocked';reason:'invalid_view'|'owner_read_unavailable'|'snapshot_mismatch'|'calendar_unavailable'}
  | {kind:'ready';scope:'train_calendar_read_only';calendar:Extract<CoachCalendarContextResult,{kind:'ready'}>;
     plannedSnapshotVersion:string;completedSnapshotVersion:string;
     noAutomaticPlanWrite:true;noInferredCompletion:true};

/**
 * A complete, verified empty read is safe; an absent or partial read is NOT.
 * Distinct owner revisions are preserved rather than claiming one atomic
 * cross-domain transaction. The caller must refresh both before applying.
 */
export function prepareCoachCertifiedCalendar(input:CoachCertifiedCalendarInput):CoachCertifiedCalendarResult {
  if(!input||!['week','month'].includes(input.view))return{kind:'blocked',reason:'invalid_view'};
  const range=visibleCalendarReadRange(input.view,input.selectedDay);
  if(!range)return{kind:'blocked',reason:'invalid_view'};
  const shared={
    expectedOwnerId:input.expectedOwnerId,authenticatedOwnerId:input.authenticatedOwnerId,
    activeSessionGeneration:input.activeSessionGeneration,accessGateReady:input.accessGateReady,
    requestedFromDate:range.fromDate,requestedThroughDate:range.throughDate
  };
  const planned=certifyCalendarOwnerRead({...shared,snapshot:input.plannedSnapshot});
  const completed=certifyCalendarOwnerRead({...shared,snapshot:input.completedSnapshot});
  if(planned.status!=='ready'||completed.status!=='ready')
    return{kind:'blocked',reason:'owner_read_unavailable'};
  // Both owner reads must describe the same requested window and auth generation.
  // Each domain can independently advance its own snapshot revision.
  if(input.plannedSnapshot!.fromDate!==input.completedSnapshot!.fromDate||
     input.plannedSnapshot!.throughDate!==input.completedSnapshot!.throughDate)
    return{kind:'blocked',reason:'snapshot_mismatch'};
  const combined=combineCalendarReads({
    ownerId:input.expectedOwnerId,fromDate:range.fromDate,throughDate:range.throughDate,
    planned,completed
  });
  if(combined.status!=='ready'||combined.planned.status!=='ready'||combined.completed.status!=='ready')
    return{kind:'blocked',reason:'calendar_unavailable'};
  const linked=new Set(combined.completed.records
    .filter(c=>c.plannedSessionId!==null)
    .map(c=>c.plannedSessionId));
  const sessions:CoachCalendarSession[]=[
    ...combined.planned.records
      .filter(p=>p.sport!=='rest'&&p.sport!=='recovery'&&!linked.has(p.id))
      .map(p=>({id:'planned:'+p.id,ownerId:p.ownerId,athleteLocalDate:p.athleteLocalDate,
        sport:p.sport as CoachCalendarSession['sport'],status:p.state as CoachCalendarSession['status'],
        planRevisionId:p.planRevisionId})),
    ...combined.completed.records.map(c=>({
      id:'completed:'+c.id,ownerId:c.ownerId,athleteLocalDate:c.athleteLocalDate,
      sport:c.sport,status:'completed' as const,planRevisionId:null
    }))
  ];
  const calendar=prepareCoachCalendarContext({...shared,selectedDay:input.selectedDay,view:input.view,sessions});
  if(calendar.kind!=='ready')return{kind:'blocked',reason:'calendar_unavailable'};
  return{kind:'ready',scope:'train_calendar_read_only',calendar,
    plannedSnapshotVersion:input.plannedSnapshot!.snapshotVersion,
    completedSnapshotVersion:input.completedSnapshot!.snapshotVersion,
    noAutomaticPlanWrite:true,noInferredCompletion:true};
}
