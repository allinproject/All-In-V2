/**
 * ALL-228 dry-run import reconciliation for the proposed Ingredient Database.
 * This previews SOURCE CANDIDATES only. It never publishes nutrition, assigns
 * canonical IDs, mutates records, downloads data, or bypasses reviewer approval.
 */
import { validateGtin } from './foodProductLookup.ts';

export type IngredientSeedSource = 'usda_fdc' | 'open_food_facts';
export type IngredientSeedCandidate = {
  provider: IngredientSeedSource;
  source_data_type: 'Foundation' | 'SR Legacy' | 'Branded' | 'OFF product';
  external_record_id: string;
  payload_sha256: string;
  description: string;
  /** Stable V2 identity can only come from an already approved mapping. */
  mapped_ingredient_id?: string | null;
};
export type ExistingIngredientSource = {
  provider: IngredientSeedSource;
  source_data_type: IngredientSeedCandidate['source_data_type'];
  external_record_id: string;
  payload_sha256: string;
  ingredient_id: string | null;
};
export type IngredientSeedPreview = {
  snapshot_id: string;
  importer_version: string;
  actions: Array<{
    source_key: string;
    action: 'candidate_insert' | 'unchanged' | 'review_changed_source' | 'conflict';
    reason: string;
    /** Never a calculation-ready publication operation. */
    calculation_ready: false;
  }>;
  counts: { candidate_insert: number; unchanged: number; review_changed_source: number; conflict: number };
};
const hexSha = /^[0-9a-f]{64}$/i;
const positiveFdcId = /^[0-9]{1,12}$/;
const keyOf = (r: Pick<IngredientSeedCandidate, 'provider'|'source_data_type'|'external_record_id'>) =>
  JSON.stringify([r.provider, r.source_data_type, r.external_record_id]);
function validCandidate(row: IngredientSeedCandidate): boolean {
  if (!row || !row.description?.trim() || !hexSha.test(row.payload_sha256) ||
    !row.external_record_id?.trim()) return false;
  if (row.provider === 'usda_fdc') {
    return ['Foundation', 'SR Legacy', 'Branded'].includes(row.source_data_type) &&
      positiveFdcId.test(row.external_record_id) && Number(row.external_record_id) > 0;
  }
  // OFF candidates must be reviewed separately by exact GTIN reader; never
  // treat a generic FDC ID or an unvalidated barcode as an ingredient ID.
  return row.provider === 'open_food_facts' && row.source_data_type === 'OFF product' &&
    validateGtin(row.external_record_id) !== null;
}
/**
 * Stable sorted preview. Conflicting duplicate source keys are held for review.
 * A changed source digest never overwrites a reviewed profile implicitly.
 */
export function previewIngredientSeed(input: {
  snapshot_id: string;
  importer_version: string;
  candidates: readonly IngredientSeedCandidate[];
  existing: readonly ExistingIngredientSource[];
}): IngredientSeedPreview {
  if (!input?.snapshot_id?.trim() || !input.importer_version?.trim() ||
      !Array.isArray(input.candidates) || !Array.isArray(input.existing)) {
    throw new Error('A versioned ingredient source snapshot and collections are required.');
  }
  const existing = new Map<string, ExistingIngredientSource>();
  for (const row of input.existing) {
    // A corrupt baseline must not be trusted as proof that an import is unchanged.
    if (!validCandidate({ ...row, description: 'existing reviewed source' }) ||
        (row.ingredient_id !== null && (typeof row.ingredient_id !== 'string' || !row.ingredient_id.trim()))) {
      throw new Error('Existing ingredient source identity or digest is invalid.');
    }
    const key = keyOf(row);
    if (existing.has(key)) throw new Error('Existing ingredient source identity has duplicate mappings.');
    existing.set(key, row);
  }
  const grouped = new Map<string, IngredientSeedCandidate[]>();
  for (const row of input.candidates) {
    const key = row ? keyOf(row) : 'malformed:null';
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const counts: IngredientSeedPreview['counts'] = {
    candidate_insert: 0, unchanged: 0, review_changed_source: 0, conflict: 0,
  };
  const actions: IngredientSeedPreview['actions'] = [];
  for (const [source_key, rows] of [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b))) {
    const candidate = rows[0];
    let action: IngredientSeedPreview['actions'][number]['action'];
    let reason: string;
    if (rows.length !== 1 || !validCandidate(candidate) ||
        (candidate.mapped_ingredient_id !== null && candidate.mapped_ingredient_id !== undefined &&
          !candidate.mapped_ingredient_id.trim())) {
      action = 'conflict';
      reason = 'Malformed or duplicate provider source identity requires review.';
    } else {
      const saved = existing.get(source_key);
      if (!saved) {
        // Even an input hint to an existing ID cannot publish a source mapping.
        action = 'candidate_insert';
        reason = 'New provider record must be reviewed before ingredient mapping or profile publication.';
      } else if (candidate.mapped_ingredient_id && candidate.mapped_ingredient_id !== saved.ingredient_id) {
        action = 'conflict';
        reason = 'Provider record disagrees with an approved stable ingredient mapping.';
      } else if (saved.payload_sha256.toLowerCase() !== candidate.payload_sha256.toLowerCase()) {
        action = 'review_changed_source';
        reason = 'Source payload changed: retain previous source and reviewed profile until explicit reconciliation.';
      } else {
        action = 'unchanged';
        reason = 'Exact provider identity and source snapshot digest already exist.';
      }
    }
    counts[action] += 1;
    actions.push({ source_key, action, reason, calculation_ready: false });
  }
  return { snapshot_id: input.snapshot_id, importer_version: input.importer_version, actions, counts };
}
