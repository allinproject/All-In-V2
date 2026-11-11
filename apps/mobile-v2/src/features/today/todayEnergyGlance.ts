import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/**
 * ALL-250: one read-only projection of a versioned canonical Fuel daily snapshot.
 * Do not independently recompute "left to eat" or turn absent records into 0.
 * A future Fuel owner supplies the verified data; Today never writes it.
 */
export type DailyEnergySnapshot = {
  ownerId: string;
  athleteLocalDate: string;
  sourceRevision: string;
  calculatedAt: string;
  burnedCalories: number | null;
  eatenCalories: number | null;
  remainingCalories: number | null;
};
export type DailyEnergyEvidence =
  | { status: 'unavailable' | 'loading' | 'error'; snapshot?: never }
  | { status: 'ready'; snapshot: DailyEnergySnapshot };
export type TodayEnergyGlance = {
  status: 'unavailable' | 'partial' | 'ready' | 'stale';
  burned: string;
  eaten: string;
  remaining: string;
  detail: string;
  sourceRevision: string | null;
};
const UNKNOWN = '—';
const missing: TodayEnergyGlance = {
  status: 'unavailable', burned: UNKNOWN, eaten: UNKNOWN, remaining: UNKNOWN,
  detail: 'Nutrition totals are unavailable until verified Fuel and activity data are connected.',
  sourceRevision: null,
};
function validEnergy(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && Number.isSafeInteger(value) &&
    value >= -100000 && value <= 100000);
}
function display(value: number | null): string {
  return value === null ? UNKNOWN : value.toLocaleString('en-US');
}
/** Freshness is a display guard only. The Fuel owner alone determines the totals. */
export function todayEnergyGlance(
  evidence: DailyEnergyEvidence,
  ownerId: string,
  athleteLocalDate: string | null,
  now: Date = new Date(),
): TodayEnergyGlance {
  if (!ownerId || !athleteLocalDate || !validAthleteLocalDate(athleteLocalDate)
    || evidence.status !== 'ready') return missing;
  const s = evidence.snapshot;
  if (!s || s.ownerId !== ownerId || s.athleteLocalDate !== athleteLocalDate
    || typeof s.sourceRevision !== 'string' || !s.sourceRevision.trim()
    || !validEnergy(s.burnedCalories) || !validEnergy(s.eatenCalories)
    || !validEnergy(s.remainingCalories)) return missing;
  const timestamp = Date.parse(s.calculatedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now.getTime())
    || timestamp > now.getTime() + 5 * 60_000) return missing;
  const values = [s.burnedCalories, s.eatenCalories, s.remainingCalories];
  const complete = values.every(value => value !== null);
  // A cached summary older than 24 h cannot be presented as current. On
  // divergence Fuel should refresh, not have Today silently recalculate.
  const stale = now.getTime() - timestamp > 24 * 60 * 60_000;
  return {
    status: stale ? 'stale' : complete ? 'ready' : 'partial',
    burned: stale ? UNKNOWN : display(s.burnedCalories),
    eaten: stale ? UNKNOWN : display(s.eatenCalories),
    remaining: stale ? UNKNOWN : display(s.remainingCalories),
    detail: stale
      ? 'Daily totals need refreshing in Fuel; the last verified snapshot is stale.'
      : complete
        ? 'Verified Fuel summary. Open daily details for source information.'
        : 'Some Fuel or activity totals are not yet available; missing values are not zero.',
    sourceRevision: s.sourceRevision,
  };
}
