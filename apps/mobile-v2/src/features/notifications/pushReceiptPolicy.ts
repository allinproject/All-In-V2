/**
 * ALL-237: Expo push ticket/receipt interpretation.
 *
 * This is a PURE contract, not a sender, scheduled job or token database.
 * Server must atomically claim the canonical notification decision before
 * sending, associate ticket IDs with owner-scoped device rows, and process
 * receipts without leaking tokens to logs or telemetry.
 */
export type ExpoPushResult = {
  status?: unknown;
  id?: unknown;
  details?: { error?: unknown } | null;
};
export type PushFollowUp =
  | { action: 'await_receipt'; receiptId: string }
  | { action: 'confirmed_provider_handoff' }
  | { action: 'retire_device_token'; reason: 'device_unregistered' }
  | { action: 'retry_with_backoff'; reason: 'rate_limited' }
  | { action: 'operator_review'; reason: 'credentials' | 'payload' | 'unknown_error' }
  | { action: 'hold_unverified' };

const credentialErrors = new Set(['InvalidCredentials', 'MismatchSenderId']);
const payloadErrors = new Set(['MessageTooBig', 'MessageTooManyNotifications', 'PUSH_TOO_MANY_NOTIFICATIONS']);

function errorCode(result: ExpoPushResult | null | undefined): string {
  return typeof result?.details?.error === 'string' ? result.details.error : '';
}

export function evaluatePushTicket(result: ExpoPushResult | null | undefined): PushFollowUp {
  if (!result) return { action: 'hold_unverified' };
  if (result.status === 'ok') {
    return typeof result.id === 'string' && result.id.trim()
      ? { action: 'await_receipt', receiptId: result.id }
      : { action: 'hold_unverified' };
  }
  if (result.status !== 'error') return { action: 'hold_unverified' };
  return classifyError(errorCode(result));
}

export function evaluatePushReceipt(result: ExpoPushResult | null | undefined): PushFollowUp {
  if (!result) return { action: 'hold_unverified' };
  if (result.status === 'ok') return { action: 'confirmed_provider_handoff' };
  if (result.status !== 'error') return { action: 'hold_unverified' };
  return classifyError(errorCode(result));
}

function classifyError(code: string): PushFollowUp {
  if (code === 'DeviceNotRegistered') return { action: 'retire_device_token', reason: 'device_unregistered' };
  if (code === 'MessageRateExceeded' || code === 'TOO_MANY_REQUESTS') {
    return { action: 'retry_with_backoff', reason: 'rate_limited' };
  }
  if (credentialErrors.has(code)) return { action: 'operator_review', reason: 'credentials' };
  if (payloadErrors.has(code)) return { action: 'operator_review', reason: 'payload' };
  // Fail closed: never retry unknown malformed responses, which risks repeats.
  return { action: 'operator_review', reason: 'unknown_error' };
}

/**
 * Network/whole-request failures are different from a ticket/receipt.
 * Only explicitly temporary codes are eligible to retry, and only within
 * the owning ledger's deduplication and expiration constraints.
 */
export function evaluatePushHttpStatus(status: number | null): PushFollowUp {
  if (status === 429 || (status !== null && Number.isInteger(status) && status >= 500 && status <= 599)) {
    return { action: 'retry_with_backoff', reason: 'rate_limited' };
  }
  return { action: 'operator_review', reason: status === 400 || status === 413 ? 'payload' : 'unknown_error' };
}

/**
 * Lock-screen copy is intentionally content-neutral. No workout title,
 * location, health inference or diet details are allowed in notification
 * payloads. Private context is fetched only after authenticated app open.
 */
export function publicNotificationCopy(priority: 'safety' | 'actionable' | 'optional') {
  return priority === 'safety'
    ? { title: 'ALL IN 365', body: 'A time-sensitive update is available in the app.' }
    : { title: 'ALL IN 365', body: 'You have an update in the app.' };
}
