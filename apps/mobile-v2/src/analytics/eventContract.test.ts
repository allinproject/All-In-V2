import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareV2AnalyticsEvent, V2_ANALYTICS_EVENTS } from './eventContract.ts';

test('all defined V2 event names have no private properties', () => {
  for (const event of Object.values(V2_ANALYTICS_EVENTS)) {
    assert.deepEqual(prepareV2AnalyticsEvent(event), { event, properties: {} });
  }
});

test('arbitrary event names are rejected rather than sent', () => {
  assert.throws(
    () => prepareV2AnalyticsEvent('athlete_private_notes' as never),
    /Unsupported V2 analytics event/,
  );
});

test('event names are stable and unique', () => {
  const events = Object.values(V2_ANALYTICS_EVENTS);
  assert.equal(new Set(events).size, events.length);
  assert.ok(events.every(name => /^[a-z]+(?:_[a-z]+)+$/.test(name)));
});
