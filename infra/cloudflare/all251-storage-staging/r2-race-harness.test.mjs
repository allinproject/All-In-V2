import assert from 'node:assert/strict';
import test from 'node:test';
import {holdSyntheticR2Put} from './r2-race-harness.test-helper.mjs';

const target = '11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.bin';
const other = '22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.bin';

function fixture(options) {
 const writes = [];
 const binding = {get() {}, head() {}, delete() {}, put(key) { writes.push(key); }};
 return {...holdSyntheticR2Put(binding, target, options), writes};
}

test('pause is scoped to one synthetic path and allows one release', async () => {
 const harness = fixture();
 const pending = harness.binding.put(target);
 await harness.entered;
 try {
  assert.deepEqual(harness.writes, []);
  await harness.binding.put(other);
  assert.deepEqual(harness.writes, [other]);
 } finally {
  harness.release();
  await pending;
 }
 assert.deepEqual(harness.writes, [other, target]);
 await assert.rejects(harness.binding.put(target), /already used/);
});

test('expired pause does not call R2 even after release', async () => {
 const harness = fixture({timeoutMs: 10});
 await assert.rejects(harness.binding.put(target), /pause expired/);
 harness.release();
 assert.deepEqual(harness.writes, []);
});
