import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseFdcCandidateForReviewedProfile, normalizeFdcGenericFood } from './foodDataCentral.ts';

const at = '2026-11-10T00:00:00.000Z';
const food = (overrides: Record<string, unknown> = {}) => ({
  fdcId: 12345,
  description: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
  dataType: 'SR Legacy',
  foodNutrients: [
    { nutrientId: 1008, unitName: 'KCAL', value: 165 },
    { nutrientId: 1003, unitName: 'G', value: 31 },
    { nutrientId: 1005, unitName: 'G', value: 0 },
    { nutrientId: 1004, unitName: 'G', value: 3.6 },
    { nutrientId: 1079, unitName: 'G', value: 0 },
    { nutrientId: 1258, unitName: 'G', value: 1 },
    { nutrientId: 1093, unitName: 'MG', value: 74 },
  ],
  ...overrides,
});

test('normalizes SR Legacy generic nutrition to a sourced 100g candidate', () => {
  const result = normalizeFdcGenericFood(food(), at);
  assert.ok(result);
  assert.equal(result.source_id, '12345');
  assert.equal(result.nutrition_basis, '100g');
  assert.equal(result.calories, 165);
  assert.equal(result.protein_g, 31);
  assert.equal(result.carbs_g, 0);
  assert.equal(result.fat_g, 3.6);
  assert.equal(result.sodium_mg, 74);
  assert.equal(result.usable, true);
  assert.equal(result.review_required, true);
});

test('Foundation calorie nutrient preference is deterministic', () => {
  const result = normalizeFdcGenericFood(food({
    dataType: 'Foundation',
    foodNutrients: [
      { nutrientId: 1008, unitName: 'KCAL', value: 150 },
      { nutrientId: 2048, unitName: 'KCAL', value: 152 },
      { nutrientId: 1003, unitName: 'G', value: 30 },
      { nutrientId: 1005, unitName: 'G', value: 0 },
      { nutrientId: 1004, unitName: 'G', value: 2 },
    ],
  }), at);
  assert.equal(result?.calories, 152);
});

test('missing nutrients remain null and make the candidate unusable', () => {
  const result = normalizeFdcGenericFood(food({
    foodNutrients: [{ nutrientId: 1008, unitName: 'KCAL', value: 100 }],
  }), at);
  assert.equal(result?.protein_g, null);
  assert.equal(result?.carbs_g, null);
  assert.equal(result?.fat_g, null);
  assert.equal(result?.usable, false);
});

test('branded records, malformed IDs and invalid timestamps are rejected', () => {
  assert.equal(normalizeFdcGenericFood(food({ dataType: 'Branded' }), at), null);
  assert.equal(normalizeFdcGenericFood(food({ fdcId: 'not-an-id' }), at), null);
  assert.equal(normalizeFdcGenericFood(food(), 'not-a-date'), null);
});

test('a raw USDA candidate requires explicit identity and preparation confirmation', () => {
  const candidate = normalizeFdcGenericFood(food(), at);
  assert.ok(candidate);
  assert.equal(canUseFdcCandidateForReviewedProfile(candidate, {
    identityConfirmed: false, preparationStateConfirmed: true,
  }), false);
  assert.equal(canUseFdcCandidateForReviewedProfile(candidate, {
    identityConfirmed: true, preparationStateConfirmed: false,
  }), false);
  assert.equal(canUseFdcCandidateForReviewedProfile(candidate, {
    identityConfirmed: true, preparationStateConfirmed: true,
  }), true);
});


function normalizedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    source: 'usda_fdc',
    source_id: '12345',
    data_type: 'SR Legacy',
    food_description: 'Chicken breast, cooked',
    nutrition_basis: '100g',
    portion_label: '100 g',
    calories: 165,
    protein_g: 31,
    carbs_g: 0,
    fat_g: 3.6,
    fiber_g: 0,
    saturated_fat_g: 1,
    sodium_mg: 74,
    usable: true,
    source_quality: 'usda_reference_unreviewed',
    source_license: 'USDA FoodData Central / CC0 1.0',
    review_required: true,
    retrieved_at: at,
    ...overrides,
  };
}

test('parses the V2 Edge Function candidate without upgrading its review state', async () => {
  const { parseFdcGenericIngredientCandidate } = await import('./foodDataCentral.ts');
  const result = parseFdcGenericIngredientCandidate(normalizedCandidate());
  assert.equal(result?.source_id, '12345');
  assert.equal(result?.review_required, true);
  assert.equal(result?.source_quality, 'usda_reference_unreviewed');
  assert.equal(parseFdcGenericIngredientCandidate(normalizedCandidate({ data_type: 'Branded' })), null);
  assert.equal(parseFdcGenericIngredientCandidate(normalizedCandidate({ source_license: 'other' })), null);
  assert.equal(parseFdcGenericIngredientCandidate(normalizedCandidate({ source_id: 'not-an-id' })), null);
});

test('searches through the authenticated V2 Edge Function and rejects malformed envelopes', async () => {
  const { searchV2FdcGenericIngredients } = await import('./foodDataCentral.ts');
  let functionName = '';
  let body: unknown;
  const client = {
    functions: {
      invoke: async (name: string, args: { body: unknown }) => {
        functionName = name;
        body = args.body;
        return {
          error: null,
          data: {
            kind: 'generic_ingredient_candidates',
            provider: 'usda_fdc',
            source_quality: 'usda_reference_unreviewed',
            source_license: 'USDA FoodData Central / CC0 1.0',
            review_required: true,
            retrieved_at: at,
            results: [normalizedCandidate()],
          },
        };
      },
    },
  } as any;
  const result = await searchV2FdcGenericIngredients(client, ' chicken  breast ');
  assert.equal(functionName, 'v2-search-usda-ingredients');
  assert.deepEqual(body, { action: 'search', query: 'chicken breast' });
  assert.equal(result.results[0]?.source_id, '12345');
  await assert.rejects(searchV2FdcGenericIngredients(client, 'x'), /2–80 character/);
  client.functions.invoke = async () => ({ error: null, data: { kind: 'wrong' } });
  await assert.rejects(searchV2FdcGenericIngredients(client, 'chicken'), /invalid candidate response/);
});

test('refreshes detail by exact FDC ID and refuses a mismatched source identity', async () => {
  const { fetchV2FdcGenericIngredientDetail } = await import('./foodDataCentral.ts');
  let body: any;
  const client = {
    functions: {
      invoke: async (_name: string, args: { body: any }) => {
        body = args.body;
        return { error: null, data: { kind: 'generic_ingredient_candidate', provider: 'usda_fdc', review_required: true, result: normalizedCandidate() } };
      },
    },
  } as any;
  const result = await fetchV2FdcGenericIngredientDetail(client, '12345');
  assert.deepEqual(body, { action: 'detail', fdc_id: '12345' });
  assert.equal(result.source_id, '12345');
  await assert.rejects(fetchV2FdcGenericIngredientDetail(client, 'abc'), /valid USDA FDC source ID/);
  client.functions.invoke = async () => ({ error: null, data: { kind: 'generic_ingredient_candidate', provider: 'usda_fdc', review_required: true, result: normalizedCandidate({ source_id: '98765' }) } });
  await assert.rejects(fetchV2FdcGenericIngredientDetail(client, '12345'), /did not match/);
});
