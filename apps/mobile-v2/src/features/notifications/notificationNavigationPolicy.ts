/**
 * ALL-237: notification tap intents are data references, never arbitrary URLs.
 * The app authenticates and obtains the current user's authorized object before
 * navigating. The push payload carries no private object content.
 */
export type NotificationTarget = 'today' | 'train' | 'coach' | 'fuel' | 'community';
export type NotificationOpenIntent = {
  ownerId: string;
  decisionKey: string;
  target: NotificationTarget;
  /** Private context must be loaded from the canonical owner after auth. */
  sourceId: string;
};
export type NotificationOpenResult =
  | { allowed: true; route: '/home' | '/train' | '/coach' | '/fuel' | '/community'; sourceId: string }
  | { allowed: false; reason: 'signed_out' | 'wrong_owner' | 'invalid_intent' | 'access_not_verified' };

const routes: Record<NotificationTarget, '/home' | '/train' | '/coach' | '/fuel' | '/community'> = {
  today: '/home',
  train: '/train',
  coach: '/coach',
  fuel: '/fuel',
  community: '/community',
};

export function resolveNotificationOpen(
  intent: NotificationOpenIntent,
  activeOwnerId: string | null,
  /** Must come from a fresh owner-authorized canonical read, never the push payload. */
  verifiedSourceAccess: boolean,
): NotificationOpenResult {
  if (!activeOwnerId) return { allowed: false, reason: 'signed_out' };
  if (!intent.ownerId || intent.ownerId !== activeOwnerId) return { allowed: false, reason: 'wrong_owner' };
  if (!intent.decisionKey || !intent.sourceId || !Object.hasOwn(routes, intent.target)) {
    return { allowed: false, reason: 'invalid_intent' };
  }
  if (!verifiedSourceAccess) return { allowed: false, reason: 'access_not_verified' };
  return { allowed: true, route: routes[intent.target], sourceId: intent.sourceId };
}
