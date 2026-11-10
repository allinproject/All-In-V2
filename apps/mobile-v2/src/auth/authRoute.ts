export type AuthRouteState =
  | { state: 'loading' }
  | { state: 'signed_out' }
  | { state: 'signed_in'; userId: string };

export function authRouteState(input: {
  loading: boolean;
  userId?: string | null;
}): AuthRouteState {
  if (input.loading) return { state: 'loading' };
  const userId = String(input.userId ?? '').trim();
  return userId ? { state: 'signed_in', userId } : { state: 'signed_out' };
}
/** A confirmation-resend offer belongs to the email that failed sign-in. */
export function shouldOfferV2ConfirmationResend(
  pendingEmail: string | null,
  currentEmail: string,
): boolean {
  return Boolean(pendingEmail)
    && pendingEmail === currentEmail.trim().toLowerCase();
}

/**
 * An INITIAL_SESSION notification is a bootstrap snapshot, not a newer
 * authentication decision. Never let it overwrite a subsequent auth event.
 */
export function shouldApplyV2AuthEvent(
  event: string,
  hasSeenAuthoritativeEvent: boolean,
): boolean {
  return event !== 'INITIAL_SESSION' || !hasSeenAuthoritativeEvent;
}

/** A prior verification result must never grant access during a newer retry. */
export function isV2AccessAttemptCurrent(
  resultOwnerId: string | null,
  resultAttempt: number,
  activeOwnerId: string | null,
  activeAttempt: number,
  authLoading: boolean,
): boolean {
  return !authLoading && Boolean(activeOwnerId)
    && resultOwnerId === activeOwnerId
    && resultAttempt === activeAttempt;
}
