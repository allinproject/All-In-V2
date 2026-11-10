import type { ActivitySport } from './activityEntryContract';

/**
 * ALL-243/246: locally validate a proposed, unsaved manual completion.
 * The canonical Completed Activity writer must re-check owner, source,
 * timezone, units, duplication and authorization before persisting anything.
 */
export type ManualActivityInput = {
  sport: ActivitySport;
  athleteLocalDate: string;
  athleteLocalToday: string;
  durationMinutes: string;
  /** Optional, only for stair-climber and only if explicitly shown on machine. */
  machineFloors?: string;
};
export type ManualActivityDraft =
  | { valid: true; sport: ActivitySport; athleteLocalDate: string; durationSeconds: number; machineFloors: number | null; source: 'manual'; status: 'uncommitted' }
  | { valid: false; reason: 'invalid_date' | 'future_completion' | 'invalid_duration' | 'invalid_floors' };

export function validAthleteLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

export function prepareManualActivity(input: ManualActivityInput): ManualActivityDraft {
  if (!validAthleteLocalDate(input.athleteLocalDate) || !validAthleteLocalDate(input.athleteLocalToday)) return { valid: false, reason: 'invalid_date' };
  if (input.athleteLocalDate > input.athleteLocalToday) return { valid: false, reason: 'future_completion' };
  const trimmedDuration = input.durationMinutes.trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(trimmedDuration)) return { valid: false, reason: 'invalid_duration' };
  const duration = Number(trimmedDuration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) return { valid: false, reason: 'invalid_duration' };
  const floorsText = (input.machineFloors ?? '').trim();
  if (floorsText && (input.sport !== 'stair' || !/^\d+$/.test(floorsText) || !Number.isSafeInteger(Number(floorsText)))) {
    return { valid: false, reason: 'invalid_floors' };
  }
  return {
    valid: true,
    sport: input.sport,
    athleteLocalDate: input.athleteLocalDate,
    durationSeconds: Math.round(duration * 60),
    machineFloors: floorsText ? Number(floorsText) : null,
    source: 'manual',
    status: 'uncommitted',
  };
}
