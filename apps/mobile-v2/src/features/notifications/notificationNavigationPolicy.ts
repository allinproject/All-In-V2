/**
 * ALL-237: notification tap intents are data references, never arbitrary URLs.
 * Only /home exists in the current V2 shell. Future Train/Coach/Fuel/Community
 * destinations remain blocked until their real approved routes are mounted.
 *
 * The push owner/source hints are NOT authorization. A fresh authenticated
 * canonical read and the existing legal/onboarding gate must pass first.
 */
export type NotificationTarget = 'today' | 'train' | 'coach' | 'fuel' | 'community';
export type NotificationOpenIntent = {
  ownerId: string;
  decisionKey: string;
  target: NotificationTarget;
  /** No private content is carried in the push message. */
  sourceId: string;
};
export type NotificationOpenResult =
  | { allowed: true; route: '/home'; sourceId: string }
  | { allowed: false; reason: 'signed_out' | 'wrong_owner' | 'invalid_intent' | 'access_not_verified' | 'destination_unavailable' };

const supportedTargets = new Set<NotificationTarget>(['today', 'train', 'coach', 'fuel', 'community']);

export function resolveNotificationOpen(
  intent: NotificationOpenIntent,
  activeOwnerId: string | null,
  /** Verified AFTER auth by the canonical owner-scoped data reader. */
  verifiedSourceAccess: boolean,
  /** Must come from current V2 Auth and AccessGate state, not the push. */
  accessGateReady = false,
): NotificationOpenResult {
  if (!activeOwnerId) return { allowed: false, reason: 'signed_out' };
  if (!intent.ownerId || intent.ownerId !== activeOwnerId) return { allowed: false, reason: 'wrong_owner' };
  if (!intent.decisionKey || !intent.sourceId || !supportedTargets.has(intent.target)) {
    return { allowed: false, reason: 'invalid_intent' };
  }
  if (!verifiedSourceAccess || !accessGateReady) return { allowed: false, reason: 'access_not_verified' };
  if (intent.target !== 'today') return { allowed: false, reason: 'destination_unavailable' };
  return { allowed: true, route: '/home', sourceId: intent.sourceId };
}
