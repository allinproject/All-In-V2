/** ALL-239: display gate for the canonical Goals owner's future reviewed preview.
 * This does not fetch, issue consent, infer a goal, or approve a revision.
 */
export type GoalPreviewBehavior = Readonly<{
  id: string;
  description: string;
  cadence: string | null;
  evidenceSource: string | null;
  userConfirmed: boolean;
}>;

export type GoalApprovalPreview = Readonly<{
  ownerId: string;
  authSessionGeneration: number;
  complete: true;
  nextCursor: null;
  reviewId: string;
  actionId: string;
  goalId: string;
  goalRevisionId: string;
  expectedVersion: number;
  goalTitle: string;
  goalKind: string;
  goalStatus: 'draft' | 'active' | 'paused';
  priority: string;
  targetDate: string | null;
  sha256: string;
  expiresAt: string;
  behaviors: readonly GoalPreviewBehavior[];
}>;

export type GoalReviewView =
  | Readonly<{ status: 'unavailable'; message: string; preview: null }>
  | Readonly<{ status: 'review_required'; message: string; preview: GoalApprovalPreview }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Only a certified, complete snapshot may be displayed as an approval review.
 * Rerun this when account/session generation, screen focus or preview changes.
 * Real acceptance must independently reverify the same preview on the server.
 */
export function goalReviewPresentation(
  preview: GoalApprovalPreview | null,
  ownerId: string | null,
  sessionGeneration: number,
  nowMs: number,
): GoalReviewView {
  const unavailable = (message: string): GoalReviewView =>
    ({ status: 'unavailable', message, preview: null });
  if (!ownerId || !Number.isSafeInteger(sessionGeneration) || sessionGeneration < 0) {
    return unavailable('Sign in to review your goals.');
  }
  if (!preview) {
    return unavailable('Your verified Goals reader is not connected yet. Existing goals may be present; no records are being reported as empty or approved.');
  }
  if (preview.ownerId !== ownerId || preview.authSessionGeneration !== sessionGeneration ||
      preview.complete !== true || preview.nextCursor !== null) {
    return unavailable('Goal evidence belongs to another session or is incomplete. Refresh the review.');
  }
  if (![preview.goalId, preview.goalRevisionId, preview.reviewId, preview.actionId].every(
    value => typeof value === 'string' && UUID.test(value))) {
    return unavailable('Goal review identity could not be verified.');
  }
  if (!Number.isSafeInteger(preview.expectedVersion) || preview.expectedVersion < 1 ||
      !SHA256.test(preview.sha256) || !['draft', 'active', 'paused'].includes(preview.goalStatus) ||
      typeof preview.goalTitle !== 'string' || !preview.goalTitle.trim() ||
      preview.goalTitle.length > 160 || typeof preview.goalKind !== 'string' ||
      !preview.goalKind.trim() || typeof preview.priority !== 'string' ||
      !preview.priority.trim() || !validDate(preview.targetDate)) {
    return unavailable('The approved Goal preview is missing required evidence.');
  }
  const expiry = Date.parse(preview.expiresAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(nowMs) || expiry <= nowMs ||
      expiry > nowMs + 15 * 60_000) {
    return unavailable('This Goal review expired. Refresh it before approving any changes.');
  }
  if (!Array.isArray(preview.behaviors) || preview.behaviors.length > 100 ||
      preview.behaviors.some(b => !b || !UUID.test(b.id) ||
        typeof b.description !== 'string' || !b.description.trim() ||
        b.description.length > 500 || typeof b.userConfirmed !== 'boolean')) {
    return unavailable('The supporting Goal behaviors could not be verified.');
  }
  if (new Set(preview.behaviors.map(b => b.id)).size !== preview.behaviors.length) {
    return unavailable('The Goal preview contains duplicate behaviors and needs review.');
  }
  return {
    status: 'review_required',
    message: 'Review the exact proposed Goal and supporting habits. Nothing changes until you explicitly confirm and the server accepts the same revision.',
    preview,
  };
}
