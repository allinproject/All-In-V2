import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/** ALL-250: contextual reminder surface owned by canonical Kitchen scheduling.
 * Never infer due time from pantry contents, calendar emptiness or device clock.
 * No notification scheduling or recipe/cook state mutations.
 */
export type KitchenDueItem = {
  id: string;
  ownerId: string;
  athleteLocalDate: string;
  kind: 'meal_prep' | 'cook_now';
  title: string;
  status: 'due' | 'completed' | 'cancelled';
};
export type KitchenDueEvidence =
  | { status: 'unavailable' | 'loading' | 'error'; items?: never }
  | { status: 'ready'; ownerId: string; athleteLocalDate: string; sourceRevision: string; items: readonly KitchenDueItem[] };
export type TodayKitchenReminder = {
  id: string;
  title: string;
  label: 'Meal Prep' | 'Cook Now';
};
/** Null means no contextual prompt; it is not a claim that there are no plans. */
export function todayKitchenDue(
  evidence: KitchenDueEvidence,
  ownerId: string,
  day: string | null,
): readonly TodayKitchenReminder[] {
  if (!ownerId || !day || !validAthleteLocalDate(day)
    || evidence.status !== 'ready' || evidence.ownerId !== ownerId
    || evidence.athleteLocalDate !== day || typeof evidence.sourceRevision !== 'string'
    || !evidence.sourceRevision.trim() || !Array.isArray(evidence.items)) return [];
  const ids = new Set<string>();
  for (const row of evidence.items) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)
      || row.ownerId !== ownerId || row.athleteLocalDate !== day
      || !['meal_prep','cook_now'].includes(row.kind)
      || !['due','completed','cancelled'].includes(row.status)
      || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 120) return [];
    ids.add(row.id);
  }
  return evidence.items.filter(item => item.status === 'due').slice(0,2).map(item=>({
    id:item.id,
    title:item.title.trim(),
    label:item.kind==='meal_prep'?'Meal Prep':'Cook Now',
  }));
}
