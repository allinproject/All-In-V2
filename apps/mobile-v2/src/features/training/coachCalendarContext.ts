import { validAthleteLocalDate } from './manualActivityDraft.ts';
import { weekDaysForDate, monthCalendarWeeks, firstOfMonth } from './calendarDayView.ts';
import { V2_ACTIVITY_SPORTS, type ActivitySport } from './activityEntryContract.ts';

/** ALL-240/246 — read-only, owner-verified Train calendar context for Coach. */
export type CoachCalendarSession = {
  id: string;
  ownerId: string;
  athleteLocalDate: string;
  sport: ActivitySport;
  status: 'planned' | 'completed' | 'missed' | 'cancelled';
  planRevisionId: string | null;
};
export type CoachCalendarInput = {
  expectedOwnerId: string;
  authenticatedOwnerId: string | null;
  accessGateReady: boolean;
  selectedDay: string;
  view: 'week' | 'month';
  /** undefined = not read, null = verified unavailable, list = authoritative owner-scoped read */
  sessions: readonly CoachCalendarSession[] | null | undefined;
};
export type CoachCalendarContextResult =
  | { kind: 'blocked'; reason: 'signed_out' | 'wrong_owner' | 'access_gate_required' | 'invalid_day' | 'sessions_unverified' | 'session_owner_mismatch' | 'invalid_session' }
  | {
      kind: 'ready';
      scope: 'train_calendar_read_only';
      selectedDay: string;
      selectedWeek: readonly string[];
      selectedMonth: string;
      windowDays: readonly string[];
      view: 'week' | 'month';
      /** IDs only; Coach must query canonical owner before any proposal or apply. */
      sessions: readonly CoachCalendarSession[];
      noAutomaticPlanWrite: true;
    };
export function prepareCoachCalendarContext(input: CoachCalendarInput): CoachCalendarContextResult {
  if (!input.authenticatedOwnerId) return { kind: 'blocked', reason: 'signed_out' };
  if (!input.expectedOwnerId || input.expectedOwnerId !== input.authenticatedOwnerId) return { kind: 'blocked', reason: 'wrong_owner' };
  if (!input.accessGateReady) return { kind: 'blocked', reason: 'access_gate_required' };
  if (!validAthleteLocalDate(input.selectedDay)) return { kind: 'blocked', reason: 'invalid_day' };
  if (!Array.isArray(input.sessions)) return { kind: 'blocked', reason: 'sessions_unverified' };
  if (input.sessions.some(session => session.ownerId !== input.expectedOwnerId)) return { kind: 'blocked', reason: 'session_owner_mismatch' };
  const ids = new Set<string>();
  for (const session of input.sessions) {
    if (!session.id || ids.has(session.id) || !validAthleteLocalDate(session.athleteLocalDate)
      || !['planned', 'completed', 'missed', 'cancelled'].includes(session.status)
      || !V2_ACTIVITY_SPORTS.some(sport => sport === session.sport)
      || (session.planRevisionId !== null && !session.planRevisionId.trim())) {
      return { kind: 'blocked', reason: 'invalid_session' };
    }
    ids.add(session.id);
  }
  const week = weekDaysForDate(input.selectedDay);
  if (week.length !== 7) return { kind: 'blocked', reason: 'invalid_day' };
  const selectedMonth = firstOfMonth(input.selectedDay);
  if (!selectedMonth) return { kind: 'blocked', reason: 'invalid_day' };
  const windowDays = input.view === 'month'
    ? monthCalendarWeeks(input.selectedDay).flat().filter(date => date.slice(0, 7) === selectedMonth.slice(0, 7))
    : week;
  const relevantSessions = input.sessions.filter(session => windowDays.includes(session.athleteLocalDate));
  return {
    kind: 'ready',
    scope: 'train_calendar_read_only',
    selectedDay: input.selectedDay,
    selectedWeek: week,
    selectedMonth,
    windowDays,
    view: input.view,
    sessions: relevantSessions,
    noAutomaticPlanWrite: true,
  };
}

/**
 * ALL-231: bounded multi-event context for Coach, built ONLY from the same
 * authenticated, revision-certified Training phase preview.
 * This is explanatory context; never a schedule writer or source of new doses.
 */
import type {SeasonPhasePreview} from './multiEventPhaseOwnerPreview.ts';
export type CoachSeasonContextResult=
 | {kind:'blocked';reason:'missing_certified_preview'|'wrong_owner'|'stale_revision'|'invalid_season'}
 | {kind:'ready';scope:'train_season_read_only';planRevisionId:string;snapshotVersion:string;
    events:ReadonlyArray<{id:string;date:string;name:string;sport:string;priority:'A'|'B'|'C';demand:string}>;
    phaseReviews:ReadonlyArray<{date:string;eventId:string;kind:string}>;
    unresolved:ReadonlyArray<{code:string;eventIds:string[];date:string|null;message:string}>;
    requiresAthleteApproval:true;noAutomaticPlanWrite:true;noInventedTrainingDose:true};
export function prepareCoachSeasonContext(input:{
 expectedOwnerId:string;authenticatedOwnerId:string|null;activePlanRevisionId:string;
 accessGateReady:boolean;preview:SeasonPhasePreview|null|undefined;
}):CoachSeasonContextResult{
 if(!input?.preview||input.preview.status==='unavailable'||!input.accessGateReady)
  return{kind:'blocked',reason:'missing_certified_preview'};
 if(!input.expectedOwnerId||input.expectedOwnerId!==input.authenticatedOwnerId||
    input.preview.ownerId!==input.expectedOwnerId)
  return{kind:'blocked',reason:'wrong_owner'};
 if(!input.activePlanRevisionId||input.preview.planRevisionId!==input.activePlanRevisionId)
  return{kind:'blocked',reason:'stale_revision'};
 const {draft,phases}=input.preview;
 if(!draft.events.length||draft.events.length>20||phases.annotations.length>400||
    draft.events.some(event=>!event.id?.trim()||!event.name?.trim()||event.name.length>160||
      !event.sport?.trim()||event.sport.length>70)||
    phases.annotations.some(a=>!draft.events.some(e=>e.id===a.eventId))||
    input.preview.canWriteAcceptedPlan!==false)
   return{kind:'blocked',reason:'invalid_season'};
 return{kind:'ready',scope:'train_season_read_only',
  planRevisionId:input.preview.planRevisionId,snapshotVersion:input.preview.snapshotVersion,
  events:draft.events.map(e=>({id:e.id,date:e.date,name:e.name,sport:e.sport,priority:e.priority,demand:e.demand})),
  phaseReviews:phases.annotations.map(p=>({date:p.date,eventId:p.eventId,kind:p.kind})),
  unresolved:[
   ...draft.issues.map(i=>({code:i.code,eventIds:[...i.eventIds],date:null,message:i.message})),
   ...phases.issues.map(i=>({code:i.code,eventIds:[...i.eventIds],date:i.date,message:i.message}))
  ],
  requiresAthleteApproval:true,noAutomaticPlanWrite:true,noInventedTrainingDose:true};
}
