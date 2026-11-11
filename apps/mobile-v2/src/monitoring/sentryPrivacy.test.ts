import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubCrashEvent, sentryDsnIsConfigured } from './sentryPrivacy.ts';

test('crash telemetry redacts account, athlete and request information', () => {
  const event = {
    user: { email: 'athlete@example.test', id: 'private-id' },
    request: { headers: { Authorization: 'secret' } },
    contexts: { device: { ip: '127.0.0.1' } },
    extra: { medicalHistory: 'private' },
    tags: { workout: 'private' },
    breadcrumbs: [{ message: 'food log' }],
    message: 'Email athlete@example.test',
    exception: { values: [{ type: 'TypeError', value: 'private training note', stacktrace: { frames: [{ filename: 'app.tsx', vars: { token: 'secret' }, context_line: 'private', pre_context: ['secret'], post_context: ['private'] }] } }] },
  };
  const result = scrubCrashEvent(event);
  for (const key of ['user','request','contexts','extra','tags','breadcrumbs','message']) {
    assert.equal(Object.hasOwn(result,key),false,key);
  }
  assert.equal(result.exception.values[0].type,'TypeError');
  assert.equal(result.exception.values[0].value,'[redacted]');
  assert.deepEqual(result.exception.values[0].stacktrace.frames, [{ filename: 'app.tsx' }]);
});

test('empty and missing events scrub safely', () => {
  assert.deepEqual(scrubCrashEvent({}), {});
  assert.deepEqual(scrubCrashEvent({ exception: { values: [{}] } }), { exception: { values: [{}] } });
});

test('reporting requires a complete HTTPS project DSN', () => {
  assert.equal(sentryDsnIsConfigured(undefined),false);
  assert.equal(sentryDsnIsConfigured(''),false);
  assert.equal(sentryDsnIsConfigured('YOUR_SENTRY_DSN'),false);
  assert.equal(sentryDsnIsConfigured('http://key@example.com/1'),false);
  assert.equal(sentryDsnIsConfigured('https://key@o123.ingest.sentry.io/456'),true);
});

test('sensitive stack-frame paths are removed without discarding safe bundle locations', () => {
  const event = {
    exception: { values: [{ stacktrace: { frames: [
      { filename: 'src/monitoring/sentry.ts', abs_path: '/Users/athlete/private/path.ts', module: 'token-in-module', lineno: 42 },
      { filename: 'https://example.com/path?token=private', lineno: 10 },
      { filename: 'C:\\\\Users\\\\athlete\\\\private.ts', lineno: 11 },
      { filename: '/home/athlete/private.ts', lineno: 12 },
    ] } }] },
  };
  const result = scrubCrashEvent(event);
  assert.deepEqual(result.exception.values[0].stacktrace.frames, [
    { filename: 'src/monitoring/sentry.ts', lineno: 42 },
    { lineno: 10 },
    { lineno: 11 },
    { lineno: 12 },
  ]);
});
