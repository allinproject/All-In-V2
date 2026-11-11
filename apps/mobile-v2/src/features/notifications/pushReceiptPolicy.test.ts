import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluatePushTicket,
  evaluatePushReceipt,
  evaluatePushHttpStatus,
  publicNotificationCopy,
} from './pushReceiptPolicy.ts';

test('a ticket only proves accepted by Expo; receipt is still required', () => {
  assert.deepEqual(evaluatePushTicket({ status: 'ok', id: 'receipt-1' }), { action: 'await_receipt', receiptId: 'receipt-1' });
  assert.deepEqual(evaluatePushTicket({ status: 'ok' }), { action: 'hold_unverified' });
  assert.deepEqual(evaluatePushReceipt({ status: 'ok' }), { action: 'confirmed_provider_handoff' });
});

test('DeviceNotRegistered retires token on either ticket or receipt', () => {
  const result = { status: 'error', details: { error: 'DeviceNotRegistered' } };
  assert.deepEqual(evaluatePushTicket(result), { action: 'retire_device_token', reason: 'device_unregistered' });
  assert.deepEqual(evaluatePushReceipt(result), { action: 'retire_device_token', reason: 'device_unregistered' });
});

test('rate limits retry with backoff; invalid credentials never retry blindly', () => {
  assert.equal(evaluatePushReceipt({ status: 'error', details: { error: 'MessageRateExceeded' } }).action, 'retry_with_backoff');
  assert.equal(evaluatePushTicket({ status: 'error', details: { error: 'InvalidCredentials' } }).action, 'operator_review');
  assert.equal(evaluatePushReceipt({ status: 'error', details: { error: 'MismatchSenderId' } }).action, 'operator_review');
  assert.equal(evaluatePushReceipt({ status: 'error', details: { error: 'MessageTooBig' } }).action, 'operator_review');
});

test('missing, malformed and unknown responses never imply successful delivery', () => {
  for (const result of [null, undefined, {}, { status: 'bogus' }]) {
    assert.equal(evaluatePushReceipt(result).action, 'hold_unverified');
  }
  assert.equal(evaluatePushReceipt({ status: 'error', details: { error: 'unknown' } }).action, 'operator_review');
});

test('request 429 and 5xx can retry, bad requests require review', () => {
  assert.equal(evaluatePushHttpStatus(429).action, 'retry_with_backoff');
  assert.equal(evaluatePushHttpStatus(503).action, 'retry_with_backoff');
  assert.deepEqual(evaluatePushHttpStatus(400), { action: 'operator_review', reason: 'payload' });
  assert.equal(evaluatePushHttpStatus(401).action, 'operator_review');
});

test('lock-screen push text never includes private athlete details', () => {
  for (const priority of ['safety', 'actionable', 'optional'] as const) {
    const copy = publicNotificationCopy(priority);
    assert.equal(copy.title, 'ALL IN 365');
    assert.ok(!/health|run|workout|diet|location|meal|injury|race/i.test(copy.body));
  }
});
