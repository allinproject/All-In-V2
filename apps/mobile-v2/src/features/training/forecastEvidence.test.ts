import assert from 'node:assert/strict';
import test from 'node:test';
import { unavailableForecastReason, type ScheduledForecastEvidence } from './forecastEvidence.ts';

const valid: ScheduledForecastEvidence = {
  provider: 'nws',
  workoutAreaConfirmed: true,
  workoutTime: '2026-11-11T07:00:00-06:00',
  forecastStart: '2026-11-11T06:00:00-06:00',
  forecastEnd: '2026-11-11T08:00:00-06:00',
  forecastIssuedAt: '2026-11-10T09:00:00-06:00',
  evaluatedAt: '2026-11-10T10:00:00-06:00',
};

test('scheduled workout receives evidence only inside the actual forecast interval', () => {
  assert.equal(unavailableForecastReason(valid), null);
  assert.equal(unavailableForecastReason({ ...valid, workoutTime: valid.forecastEnd }), 'workout_outside_forecast');
  assert.equal(unavailableForecastReason({ ...valid, workoutTime: '2026-11-19T07:00:00-06:00' }), 'workout_outside_forecast');
});

test('declines weather-specific advice when workout location is unconfirmed', () => {
  assert.equal(unavailableForecastReason({ ...valid, workoutAreaConfirmed: false }), 'workout_area_unconfirmed');
});

test('rejects ambiguous timezones and future-dated issue timestamps', () => {
  assert.equal(unavailableForecastReason({ ...valid, workoutTime: '2026-11-11T07:00:00' }), 'invalid_time');
  assert.equal(unavailableForecastReason({ ...valid, forecastIssuedAt: '2026-11-12T09:00:00-06:00' }), 'invalid_forecast');
});

test('rejects past sessions and inverted forecast intervals', () => {
  assert.equal(unavailableForecastReason({ ...valid, evaluatedAt: '2026-11-12T10:00:00-06:00' }), 'workout_in_past');
  assert.equal(unavailableForecastReason({ ...valid, forecastEnd: valid.forecastStart }), 'invalid_forecast');
});
