import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/** ALL-250: read-only glimpse of canonical Fuel entries.
 * No calorie recomputation, media URL synthesis, or independent writer.
 */
export type FuelLogEntry = {
  id: string;
  ownerId: string;
  athleteLocalDate: string;
  label: string;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
  createdAt: string;
};
export type FuelLogDayEvidence =
  | { status: 'loading' | 'unavailable' | 'error'; entries?: never }
  | { status: 'ready'; ownerId: string; athleteLocalDate: string; sourceRevision: string; entries: readonly FuelLogEntry[] };
export type TodayFoodLog = {
  status: 'unavailable' | 'ready';
  detail: string;
  visible: readonly { id: string; label: string; meal: string }[];
  additionalCount: number;
};
const fallback: TodayFoodLog = {
  status: 'unavailable',
  detail: 'Today’s food entries have not been loaded. Entries may exist; none are assumed missing.',
  visible: [],
  additionalCount: 0,
};
const meals = ['breakfast','lunch','dinner','snack','other'];
export function todayFoodLog(evidence: FuelLogDayEvidence, ownerId: string, day: string | null): TodayFoodLog {
  if (!ownerId || !day || !validAthleteLocalDate(day) || evidence.status !== 'ready'
    || evidence.ownerId !== ownerId || evidence.athleteLocalDate !== day
    || typeof evidence.sourceRevision !== 'string' || !evidence.sourceRevision.trim()
    || !Array.isArray(evidence.entries)) return fallback;
  const seen = new Set<string>();
  for (const row of evidence.entries) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id)
      || row.ownerId !== ownerId || row.athleteLocalDate !== day
      || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 160
      || !meals.includes(row.meal) || !Number.isFinite(Date.parse(row.createdAt))) return fallback;
    seen.add(row.id);
  }
  const ordered = [...evidence.entries].sort((a,b) =>
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return {
    status: 'ready',
    detail: ordered.length ? 'Recent logged foods. Open Fuel for the complete day.' :
      'No food entries in the verified log for this day.',
    visible: ordered.slice(0, 2).map(row => ({ id: row.id, label: row.label.trim(), meal: row.meal })),
    additionalCount: Math.max(0, ordered.length-2),
  };
}
