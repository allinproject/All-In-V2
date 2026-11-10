import test from 'node:test';
import assert from 'node:assert/strict';
import { previewIngredientSeed, type IngredientSeedCandidate } from './ingredientSeedPreview.ts';

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const fdc = (changes: Partial<IngredientSeedCandidate> = {}): IngredientSeedCandidate => ({
  provider: 'usda_fdc', source_data_type: 'Foundation',
  external_record_id: '12345', payload_sha256: shaA,
  description: 'Chicken breast, cooked', ...changes,
});
const preview = (
  candidates: IngredientSeedCandidate[],
  existing: Parameters<typeof previewIngredientSeed>[0]['existing'] = [],
) => previewIngredientSeed({
  snapshot_id: 'usda-foundation-2026-11-10',
  importer_version: 'v2-seed-1',
  candidates, existing,
});

test('a first seed is candidate-only and never publishes a nutrition profile', () => {
  const result = preview([fdc()]);
  assert.equal(result.counts.candidate_insert, 1);
  assert.equal(result.actions[0].calculation_ready, false);
});

test('rerunning identical source snapshot is unchanged, not a duplicate profile', () => {
  const existing = [{
    provider: 'usda_fdc' as const, source_data_type: 'Foundation' as const,
    external_record_id: '12345', payload_sha256: shaA, ingredient_id: 'v2-chicken',
  }];
  const first = preview([fdc()], existing);
  const again = preview([fdc()], existing);
  assert.deepEqual(first, again);
  assert.equal(first.counts.unchanged, 1);
  assert.equal(first.counts.candidate_insert, 0);
});

test('changed source digest requires explicit review, never overwrites published facts', () => {
  const existing = [{
    provider: 'usda_fdc' as const, source_data_type: 'Foundation' as const,
    external_record_id: '12345', payload_sha256: shaA, ingredient_id: 'v2-chicken',
  }];
  assert.equal(preview([fdc({ payload_sha256: shaB })], existing).counts.review_changed_source, 1);
  assert.equal(preview([fdc({ mapped_ingredient_id: 'another-v2' })], existing).counts.conflict, 1);
});

test('a changed digest cannot conceal a conflicting canonical ingredient mapping', () => {
  const existing = [{
    provider: 'usda_fdc' as const, source_data_type: 'Foundation' as const,
    external_record_id: '12345', payload_sha256: shaA, ingredient_id: 'approved-v2-identity',
  }];
  const outcome = preview([fdc({
    payload_sha256: shaB, mapped_ingredient_id: 'wrong-v2-identity',
  })], existing);
  assert.equal(outcome.counts.conflict, 1);
  assert.equal(outcome.counts.review_changed_source, 0);
});

test('a malformed existing source cannot masquerade as an unchanged reviewed import', () => {
  const base = {
    provider: 'usda_fdc' as const, source_data_type: 'Foundation' as const,
    external_record_id: '12345', payload_sha256: shaA, ingredient_id: 'v2-chicken',
  };
  assert.throws(() => preview([fdc()], [{ ...base, payload_sha256: 'invalid' }]),
    /Existing ingredient source identity/);
  assert.throws(() => preview([fdc()], [{ ...base, external_record_id: '000000' }]),
    /Existing ingredient source identity/);
  assert.throws(() => preview([fdc()], [{ ...base, ingredient_id: ' ' }]),
    /Existing ingredient source identity/);
});

test('source identity includes provider and data type; exact duplicates conflict', () => {
  const a = fdc();
  const b = fdc({ source_data_type: 'SR Legacy' });
  const result = preview([b,a]);
  assert.equal(result.counts.candidate_insert, 2);
  assert.equal(result.actions.length, 2);
  assert.deepEqual(preview([a,b]).actions, result.actions);
  const duplicates = preview([a,fdc({ description: 'Other source name' })]);
  assert.equal(duplicates.counts.conflict, 1);
  assert.equal(duplicates.counts.candidate_insert, 0);
});

test('OFF products must have a valid exact GTIN, and generic FDC identity is not barcode identity', () => {
  const product = fdc({
    provider: 'open_food_facts', source_data_type: 'OFF product',
    external_record_id: '036000291452',
  });
  assert.equal(preview([product]).counts.candidate_insert, 1);
  assert.equal(preview([{
    ...product, external_record_id: '036000291453',
  }]).counts.conflict, 1);
  assert.equal(preview([fdc({ external_record_id: '000000' })]).counts.conflict, 1);
  assert.equal(preview([fdc({ provider: 'usda_fdc', source_data_type: 'OFF product' })]).counts.conflict, 1);
});

test('missing digest or description is conflict, not approved nutrition', () => {
  assert.equal(preview([fdc({ payload_sha256: '' })]).counts.conflict, 1);
  assert.equal(preview([fdc({ description: ' ' })]).counts.conflict, 1);
  assert.throws(() => previewIngredientSeed({
    snapshot_id: '', importer_version: 'one', candidates: [], existing: [],
  }), /versioned ingredient source snapshot/);
});
