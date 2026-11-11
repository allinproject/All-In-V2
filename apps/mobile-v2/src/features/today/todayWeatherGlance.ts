import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/** ALL-250: Today only displays weather readback supplied by an approved owner.
 * No geolocation requests, address fetching, forecast guessing or hidden caching.
 */
export type TodayWeatherSnapshot = {
  ownerId: string;
  athleteLocalDate: string;
  observedAt: string;
  sourceRevision: string;
  /** Provider-formatted summary; units already chosen by its canonical owner. */
  display: string;
  locationConsent: 'granted';
};
export type TodayWeatherEvidence =
  | { status: 'unavailable' | 'loading' | 'error' | 'permission_denied'; snapshot?: never }
  | { status: 'ready'; snapshot: TodayWeatherSnapshot };
export type TodayWeatherGlance = { status: 'unavailable' | 'ready'; label: string };

export function todayWeatherGlance(
  evidence: TodayWeatherEvidence,
  ownerId: string,
  day: string | null,
  now: Date = new Date(),
): TodayWeatherGlance {
  const fallback: TodayWeatherGlance = { status: 'unavailable', label: 'Weather unavailable' };
  if (!ownerId || !day || !validAthleteLocalDate(day) || evidence.status !== 'ready')
    return fallback;
  const s = evidence.snapshot;
  if (!s || s.ownerId !== ownerId || s.athleteLocalDate !== day
    || s.locationConsent !== 'granted'
    || typeof s.sourceRevision !== 'string' || !s.sourceRevision.trim()
    || typeof s.display !== 'string' || !s.display.trim() || s.display.trim().length > 50
    || /[\u0000-\u001f\u007f]/.test(s.display)) return fallback;
  const time = Date.parse(s.observedAt);
  if (!Number.isFinite(time) || !Number.isFinite(now.getTime())
    || time > now.getTime() + 5 * 60_000
    || now.getTime() - time > 3 * 60 * 60_000) return fallback;
  return { status: 'ready', label: s.display.trim() };
}
