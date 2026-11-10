/**
 * ALL-237 — Pure eligibility gate for a single canonical notification event.
 * This does not send pushes or store tokens. Server ownership must enforce
 * recipient authorization, idempotency, and retry-atomic dedupe before delivery.
 */
export type NotificationCategory =
  | 'session_preparation'
  | 'weather_gear'
  | 'severe_weather'
  | 'long_session_fueling'
  | 'recovery_review'
  | 'equipment_review'
  | 'nutrition_reminder'
  | 'community';

export type NotificationPriority = 'safety' | 'actionable' | 'optional';
export type NotificationDisposition =
  | 'push'
  | 'in_app'
  | 'suppress';

export type NotificationCandidate = {
  /** Verified canonical owner, not an email, name, or device identifier. */
  ownerId: string;
  /** Canonical source event ID, e.g. the scheduled workout's stable ID. */
  sourceId: string;
  category: NotificationCategory;
  /** Material new decision revision, not a retry/refresh timestamp. */
  materialRevision: string;
  priority: NotificationPriority;
  expiresAt: string;
  scheduledFor: string;
  /** No push for completed, canceled, stale or otherwise resolved work. */
  sourceStatus: 'active' | 'completed' | 'canceled' | 'superseded';
  /** Owner already acted or declined this specific recommendation. */
  userResponse: 'none' | 'accepted' | 'dismissed' | 'declined' | 'snoozed';
  /** Must be verified from canonical owner, source, and current evidence. */
  actionableNow: boolean;
};

export type NotificationPreferences = {
  pushPermission: boolean;
  pushEnabled: boolean;
  enabledCategories: Readonly<Partial<Record<NotificationCategory, boolean>>>;
  /** Local wall-clock minutes derived for the owner's verified timezone. */
  localMinuteOfDay: number | null;
  quietStartMinute: number;
  quietEndMinute: number;
  /** Allowed push slots remaining under the owner's configured budget. */
  remainingPushBudget: number;
  /** Official safety alert opt-in; cannot override OS permission. */
  safetyPushEnabled: boolean;
  /** Suppress duplicate decision across retries and devices. */
  deliveredDecisionKeys: ReadonlySet<string>;
};

export function notificationDecisionKey(candidate: NotificationCandidate): string {
  return JSON.stringify([
    candidate.ownerId,
    candidate.sourceId,
    candidate.category,
    candidate.materialRevision,
  ]);
}

function validTimestamp(value: string): number | null {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isWithinQuietHours(
  minuteOfDay: number | null,
  start: number,
  end: number,
): boolean | null {
  if (minuteOfDay === null || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440 ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start >= 1440 || end >= 1440) {
    return null;
  }
  if (start === end) return false;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

export function evaluateNotification(
  candidate: NotificationCandidate,
  preferences: NotificationPreferences,
  nowIso: string,
): { disposition: NotificationDisposition; reason: string; decisionKey: string } {
  const decisionKey = notificationDecisionKey(candidate);
  const suppressed = (reason: string) => ({ disposition: 'suppress' as const, reason, decisionKey });
  const inApp = (reason: string) => ({ disposition: 'in_app' as const, reason, decisionKey });

  if (!candidate.ownerId || !candidate.sourceId || !candidate.materialRevision) return suppressed('missing_canonical_identity');
  const now = validTimestamp(nowIso);
  const scheduled = validTimestamp(candidate.scheduledFor);
  const expires = validTimestamp(candidate.expiresAt);
  if (now === null || scheduled === null || expires === null || expires <= scheduled) return suppressed('invalid_time');
  if (now < scheduled || now >= expires) return suppressed('not_in_delivery_window');
  if (candidate.sourceStatus !== 'active') return suppressed('source_inactive');
  if (candidate.userResponse !== 'none') return suppressed('already_addressed');
  if (!candidate.actionableNow) return suppressed('not_actionable');
  if (preferences.deliveredDecisionKeys.has(decisionKey)) return suppressed('already_delivered');
  if (preferences.enabledCategories[candidate.category] !== true) return suppressed('category_disabled');
  if (candidate.priority === 'optional') return inApp('optional_insight');

  if (!preferences.pushPermission || !preferences.pushEnabled) return inApp('push_disabled');
  const safety = candidate.priority === 'safety' && candidate.category === 'severe_weather';
  if (candidate.priority === 'safety' && !safety) return suppressed('unverified_safety_classification');
  if (safety && !preferences.safetyPushEnabled) return inApp('safety_push_disabled');

  const quiet = isWithinQuietHours(
    preferences.localMinuteOfDay,
    preferences.quietStartMinute,
    preferences.quietEndMinute,
  );
  if (quiet === null) return inApp('unknown_local_time');
  if (quiet && !safety) return inApp('quiet_hours');
  if ((!Number.isInteger(preferences.remainingPushBudget) || preferences.remainingPushBudget <= 0) && !safety) {
    return inApp('push_budget_exhausted');
  }
  return { disposition: 'push', reason: safety ? 'authorized_safety_alert' : 'actionable', decisionKey };
}
