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
