/**
 * ALL-245: read-only phone/Watch session attachment preflight.
 * Training (ALL-246) owns canonical session identity and guarded commands.
 * This function never starts/finishes a workout, mutates device state, or
 * treats a cached/offline snapshot as authoritative after reconnection.
 */
export type WatchPermissionState = 'granted' | 'denied' | 'restricted' | 'not_determined' | 'unavailable';
export type WatchSessionSnapshot = {
  instanceId: string;
  ownerId: string;
  revisionSessionId: string | null;
  status: 'active' | 'paused' | 'finishing' | 'completed' | 'cancelled' | 'abandoned' | 'skipped';
  version: number;
};
export type WatchSessionAttachmentInput = {
  expectedOwnerId: string;
  authenticatedOwnerId: string | null;
  accessGateReady: boolean;
  /** Verified server read, not a local cache. Undefined means no verified read. */
  session: WatchSessionSnapshot | null | undefined;
  watchOwnerId: string | null;
  watchInstanceId: string | null;
  watchKnownSessionVersion: number | null;
  permission: WatchPermissionState;
  connectedToCanonicalWriter: boolean;
};
export type WatchSessionAttachment =
  | { kind: 'attach'; instanceId: string; sessionVersion: number; revisionSessionId: string | null; state: 'active' | 'paused' | 'finishing'; noNewWorkout: true; noCanonicalWrite: true }
  | { kind: 'blocked' | 'reconcile'; reason: string; noNewWorkout: true; noCanonicalWrite: true };
const blocked = (kind: 'blocked' | 'reconcile', reason: string): WatchSessionAttachment => ({kind, reason, noNewWorkout: true, noCanonicalWrite: true});
function validId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
/**
 * Only a freshly read Training session may authorize Watch attachment.
 * An offline Watch can keep recording under platform control, but it cannot
 * derive an authorized new server session or claim a successful reconciliation.
 */
export function resolveWatchSessionAttachment(input: WatchSessionAttachmentInput): WatchSessionAttachment {
  if (!input || !validId(input.authenticatedOwnerId)) return blocked('blocked', 'signed_out');
  if (!validId(input.expectedOwnerId) || input.authenticatedOwnerId !== input.expectedOwnerId ||
      !validId(input.watchOwnerId) || input.watchOwnerId !== input.expectedOwnerId)
    return blocked('blocked', 'account_or_device_owner_changed');
  if (!input.accessGateReady) return blocked('blocked', 'access_gate_required');
  if (input.permission !== 'granted') return blocked('blocked', 'watch_permission_not_granted');
  if (!input.connectedToCanonicalWriter || input.session === undefined)
    return blocked('reconcile', 'fresh_canonical_session_read_required');
  const session = input.session;
  if (!session) return blocked('blocked', 'no_canonical_training_session');
  if (!validId(session.instanceId) || !validId(session.ownerId) || session.ownerId !== input.expectedOwnerId ||
      !Number.isSafeInteger(session.version) || session.version < 0 ||
      !(session.revisionSessionId === null || validId(session.revisionSessionId)))
    return blocked('blocked', 'invalid_or_cross_owner_training_session');
  if (!['active','paused','finishing'].includes(session.status))
    return blocked('blocked', 'training_session_already_terminal');
  if (input.watchInstanceId !== null &&
      (!validId(input.watchInstanceId) || input.watchInstanceId !== session.instanceId))
    return blocked('reconcile', 'watch_and_training_session_identity_conflict');
  if (input.watchKnownSessionVersion !== null &&
      (!Number.isSafeInteger(input.watchKnownSessionVersion) || input.watchKnownSessionVersion < 0 ||
       input.watchKnownSessionVersion > session.version))
    return blocked('reconcile', 'watch_session_version_conflict');
  // Older Watch version is allowed to *read* the canonical state. Event writes
  // still require a fresh expected version through Training's guarded writer.
  return {kind:'attach',instanceId:session.instanceId,sessionVersion:session.version,
    revisionSessionId:session.revisionSessionId,state:session.status as 'active'|'paused'|'finishing',
    noNewWorkout:true,noCanonicalWrite:true};
}
