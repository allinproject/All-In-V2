/**
 * ALL-230 / ALL-251: review-only preflight for the canonical Training owner's
 * first restriction certification. This is NOT a certification writer.
 * Source coverage is asserted by a trusted ingestion/recovery service, never
 * by Coach, client input or a model-generated summary.
 */
export const REQUIRED_RESTRICTION_SOURCES = [
  'current_restrictions', 'approved_plans', 'historical_records',
  'imported_records', 'restored_records',
] as const;

export type RestrictionSourceKind = typeof REQUIRED_RESTRICTION_SOURCES[number];

export type RestrictionSourceEvidence = {
  kind: RestrictionSourceKind;
  ownerId: string;
  /** True only if every authoritative page was read, even for an empty source. */
  complete: boolean;
  nextCursor: string | null;
  /** Trusted snapshot version shared by the source inventory and its reader. */
  snapshotVersion: string;
  /** Count reconciled against the canonical inventory by the trusted reader. */
  inspectedCount: number;
  reconciledCount: number;
  /** Unresolved conflicts, including missing or ambiguous provenance. */
  unresolvedCount: number;
};

export type RestrictionCoveragePreflight =
  | { status: 'blocked'; reasons: string[] }
  | { status: 'review_required'; ownerId: string; snapshotVersion: string };

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * A positive result is still NOT authority to certify. It only allows a
 * separate approved Training owner reconciler to begin final locked DB checks,
 * source signature/provenance review and a fresh canonical digest comparison.
 */
export function preflightRestrictionSourceCoverage(input: {
  expectedOwnerId: string;
  authenticatedOwnerId: string | null;
  snapshotVersion: string;
  sources: readonly RestrictionSourceEvidence[];
}): RestrictionCoveragePreflight {
  const reasons: string[] = [];
  const owner = input.expectedOwnerId;
  const version = input.snapshotVersion;
  if (typeof owner !== 'string' || !owner.trim() || input.authenticatedOwnerId !== owner) reasons.push('owner_mismatch');
  if (typeof version !== 'string' || !version.trim()) reasons.push('missing_snapshot');
  if (!Array.isArray(input.sources)) return { status: 'blocked', reasons: [...reasons, 'missing_sources'] };
  const kinds = new Set<string>();
  for (const entry of input.sources) {
    if (!entry || typeof entry !== 'object') {
      reasons.push('malformed_source');
      continue;
    }
    if (typeof entry.kind !== 'string' || !REQUIRED_RESTRICTION_SOURCES.some(kind => kind === entry.kind)) {
      reasons.push('unknown_source');
      continue;
    }
    if (kinds.has(entry.kind)) reasons.push('duplicate_source');
    kinds.add(entry.kind);
    if (typeof entry.ownerId !== 'string' || !entry.ownerId.trim() || entry.ownerId !== owner) reasons.push('source_owner_mismatch');
    if (entry.complete !== true || entry.nextCursor !== null) reasons.push('incomplete_source');
    if (typeof entry.snapshotVersion !== 'string' || !entry.snapshotVersion.trim() || entry.snapshotVersion !== version) reasons.push('stale_source');
    if (!isCount(entry.inspectedCount) || !isCount(entry.reconciledCount)
        || !isCount(entry.unresolvedCount)
        || entry.inspectedCount !== entry.reconciledCount
        || entry.unresolvedCount !== 0) reasons.push('unreconciled_source');
  }
  if (REQUIRED_RESTRICTION_SOURCES.some(kind => !kinds.has(kind))) reasons.push('missing_source');
  if (reasons.length) return { status: 'blocked', reasons: [...new Set(reasons)] };
  return { status: 'review_required', ownerId: owner, snapshotVersion: version };
}
