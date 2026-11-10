import { validAthleteLocalDate } from './manualActivityDraft.ts';
import { weekDaysForDate } from './calendarDayView.ts';
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
  const relevantSessions = input.sessions.filter(session => week.includes(session.athleteLocalDate));
  return {
    kind: 'ready',
    scope: 'train_calendar_read_only',
    selectedDay: input.selectedDay,
    selectedWeek: week,
    view: input.view,
    sessions: relevantSessions,
    noAutomaticPlanWrite: true,
  };
}
