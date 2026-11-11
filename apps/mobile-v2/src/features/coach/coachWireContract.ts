/**
 * ALL-210: parse the observed deployed allin-coach v18 response without
 * treating a proposed action as a canonical write or inventing thread history.
 *
 * This is only a wire-contract validator. No V1 endpoint is called from V2.
 */
export type V2CoachReply = {
  requestId: string;
  message: string;
  proposedAction: unknown | null;
  actionStatus: 'proposal_only';
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseCoachV18Reply(value: unknown): V2CoachReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Coach returned an invalid response.');
  }
  const item = value as Record<string, unknown>;
  if (item.error || item.retryable || item.bypassed) {
    throw new Error('Coach did not return a completed answer.');
  }
  if (typeof item.request_id !== 'string' || !UUID.test(item.request_id)) {
    throw new Error('Coach response is missing a valid request identity.');
  }
  if (typeof item.message !== 'string' || !item.message.trim() || item.message.length > 20000) {
    throw new Error('Coach response message is invalid.');
  }
  return {
    requestId: item.request_id,
    message: item.message.trim(),
    proposedAction: item.proposed_action ?? null,
    actionStatus: 'proposal_only',
  };
}

/**
 * Suppress response updates that outlive a session-generation / owner change,
 * and suppress responses from an older in-flight request.
 */
export function coachReplyIsCurrent(
  launched: { ownerId: string; sessionGeneration: number; requestNumber: number },
  current: { ownerId: string | null; sessionGeneration: number; requestNumber: number },
): boolean {
  return Boolean(launched.ownerId) &&
    launched.ownerId === current.ownerId &&
    launched.sessionGeneration === current.sessionGeneration &&
    launched.requestNumber === current.requestNumber;
}
