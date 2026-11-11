import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/**
 * ALL-250: Today is a read-only coordinated entry point, not a new workout store.
 * Use a date-only value and the canonical Train route. Never infer workouts.
 */
export function deviceLocalToday(now: Date = new Date()): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  const iso = [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return validAthleteLocalDate(iso) ? iso : null;
}

/** Keep the exact calendar day selected when arriving from Today's training hero. */
export function todayTrainingDestination(day: string | null): {
  pathname: '/train'; params: { date: string };
} | null {
  if (!day || !validAthleteLocalDate(day)) return null;
  return { pathname: '/train', params: { date: day } };
}

/** Null means the canonical day-specific Training reader is unavailable.
 * An empty verified list is NOT the same as unknown (and not an inferred rest day).
 */
export type TodayActivityEvidence<T> =
  | { status: 'unavailable' | 'loading' | 'error'; records?: never }
  | { status: 'ready'; records: readonly T[] };

export function todayActivitiesForDate<T extends { athleteLocalDate: string }>(
  evidence: TodayActivityEvidence<T>,
  day: string,
): readonly T[] | null {
  if (!validAthleteLocalDate(day) || evidence.status !== 'ready') return null;
  return evidence.records.filter(record => record.athleteLocalDate === day);
}

/** Milliseconds until the next *device-local* midnight, plus a small rollover
 * cushion. Using the local Date constructor accommodates 23/25-hour DST days.
 * The AppState/focus listeners remain authoritative after suspended timers.
 */
export function millisecondsUntilNextLocalDay(now: Date = new Date()): number | null {
  if (!Number.isFinite(now.getTime())) return null;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const delay = tomorrow.getTime() - now.getTime() + 50;
  return Number.isSafeInteger(delay) && delay >= 50 && delay <= 26 * 60 * 60 * 1000
    ? delay : null;
}

/** React Native lifecycle: refresh the local calendar day only when the app is active. */
export function shouldRefreshTodayOnAppState(state: string): boolean {
  return state === 'active';
}
