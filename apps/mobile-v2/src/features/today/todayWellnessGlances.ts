import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/** ALL-250: display-only evidence supplied by authoritative Progress/Recovery owners.
 * No inferred PR, readiness score, diagnosis, workout change or independent storage.
 */
export type TodayWellnessSnapshot = {
  ownerId: string;
  athleteLocalDate: string;
  sourceRevision: string;
  calculatedAt: string;
  label: string;
  summary: string;
  source: 'progress' | 'recovery';
  /** A factual, source-backed sport label; never infer a runner from the account. */
  sport?: string | null;
};
export type TodayWellnessEvidence =
  | { status: 'unavailable' | 'loading' | 'error'; snapshot?: never }
  | { status: 'ready'; snapshot: TodayWellnessSnapshot };
export type TodayWellnessGlance = {
  status: 'unavailable' | 'ready';
  label: string | null;
  detail: string;
};
const unavailable = {
  progress: 'Your sport- and goal-specific progress summary is not connected yet. No performance statistics are being inferred.',
  recovery: 'Your current Recovery assessment is not connected yet. No recovery recommendation is being inferred.',
};
function cleanText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
export function todayWellnessGlance(
  evidence: TodayWellnessEvidence,
  ownerId: string,
  day: string | null,
  domain: 'progress' | 'recovery',
  now: Date = new Date(),
): TodayWellnessGlance {
  const fallback: TodayWellnessGlance = {
    status: 'unavailable', label: null, detail: unavailable[domain],
  };
  if (!ownerId || !day || !validAthleteLocalDate(day) || evidence.status !== 'ready') return fallback;
  const item = evidence.snapshot;
  if (!item || item.ownerId !== ownerId || item.athleteLocalDate !== day
    || item.source !== domain || !cleanText(item.sourceRevision, 120)
    || !cleanText(item.label, 80) || !cleanText(item.summary, 400)
    || (item.sport != null && !cleanText(item.sport, 60))) return fallback;
  const at = Date.parse(item.calculatedAt);
  if (!Number.isFinite(at) || !Number.isFinite(now.getTime())
    || at > now.getTime() + 5 * 60_000
    || now.getTime() - at > 24 * 60 * 60_000) return fallback;
  return {
    status: 'ready', label: item.label.trim(), detail: item.summary.trim(),
  };
}
