/**
 * ALL-236: provider-neutral guard for scheduled-workout forecast evidence.
 * Does not fetch weather, acquire location, persist coordinates, or edit plans.
 */
export type ScheduledForecastEvidence = {
  provider: 'nws';
  workoutAreaConfirmed: boolean;
  workoutTime: string;
  forecastStart: string;
  forecastEnd: string;
  forecastIssuedAt: string;
  evaluatedAt: string;
};

/** Returns a reason to withhold weather-specific coaching, or null if time-aligned. */
export function unavailableForecastReason(evidence: ScheduledForecastEvidence): string | null {
  if (!evidence.workoutAreaConfirmed) return 'workout_area_unconfirmed';
  const times = [
    evidence.workoutTime,
    evidence.forecastStart,
    evidence.forecastEnd,
    evidence.forecastIssuedAt,
    evidence.evaluatedAt,
  ].map(value => {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
    return Date.parse(value);
  });
  if (times.some(value => !Number.isFinite(value))) return 'invalid_time';
  const [workout, start, end, issued, evaluated] = times;
  if (start >= end || issued > evaluated) return 'invalid_forecast';
  if (workout < start || workout >= end) return 'workout_outside_forecast';
  if (workout < evaluated) return 'workout_in_past';
  return null;
}
