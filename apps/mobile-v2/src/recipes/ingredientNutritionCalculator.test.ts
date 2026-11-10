import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateValidatedRecipeIngredientNutrition,
  calculateValidatedWeighedPortionNutrition,
  type IngredientNutritionProfile,
} from './ingredientNutritionCalculator.ts';

function profile(overrides: Partial<IngredientNutritionProfile> = {}): IngredientNutritionProfile {
  return {
    profile_key: 'chicken-cooked', preparation_state: 'cooked',
    basis_g: 100, basis_unit: 'g',
    calories_kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6,
    status: 'validated',
    provenance: { provider: 'usda_fdc', fdc_id: '12345', reviewed: true },
    ...overrides,
  };
}

const line = (id: string, quantity: number, p = profile()) => ({
  ingredient_id: id, profile_key: p.profile_key, preparation_state: p.preparation_state,
  quantity_g: quantity, profile: p,
});

test('calculates batch totals and per-serving values from ingredient mass bases', () => {
  const rice = profile({ profile_key: 'rice-cooked', calories_kcal: 130, protein_g: 2.7, carbs_g: 28.2, fat_g: 0.3 });
  const result = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-1', recipe_state_version: 3, servings: 2,
    ingredients: [line('chicken', 200), line('rice', 150, rice)],
  });
  assert.equal(result.status, 'validated');
  if (result.status !== 'validated') return;
  assert.equal(result.batch_totals.calories_kcal, 525);
  assert.equal(result.calories_kcal, 262.5);
  assert.equal(result.protein_g, 33.025);
  assert.equal(result.ingredient_count, 2);
  assert.equal(result.provenance.length, 2);
});

test('supports exact one-count profiles without guessing an arbitrary item weight', () => {
  const tortilla = profile({
    profile_key: 'one-tortilla', basis_g: null, basis_unit: 'each', basis_quantity: 1,
    serving_name: 'medium tortilla', calories_kcal: 140, protein_g: 4, carbs_g: 24, fat_g: 4,
  });
  const result = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-2', recipe_state_version: 'v1', servings: 1,
    ingredients: [{ ingredient_id: 'wrap', profile_key: tortilla.profile_key,
      preparation_state: 'cooked', quantity_each: 2, profile: tortilla }],
  });
  assert.equal(result.status, 'validated');
  if (result.status === 'validated') assert.equal(result.calories_kcal, 280);
});

test('calculates per-100g and weighed portions only from measured edible batch mass', () => {
  const result = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-3', recipe_state_version: 'v1', servings: 4,
    measured_edible_weight_g: 800, ingredients: [line('chicken', 400)],
  });
  assert.equal(result.status, 'validated');
  if (result.status !== 'validated') return;
  assert.equal(result.per_100g?.calories_kcal, 82.5);
  assert.deepEqual(calculateValidatedWeighedPortionNutrition(result, 200), {
    status: 'validated', portion_weight_g: 200,
    calories_kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6,
  });
});

test('rejects estimated profiles rather than promoting estimates', () => {
  const estimated = profile({ status: 'estimated' });
  const result = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-4', recipe_state_version: 1, servings: 1,
    ingredients: [line('chicken', 100, estimated)],
  });
  assert.equal(result.status, 'insufficient_evidence');
  if (result.status === 'insufficient_evidence') {
    assert.ok(result.reasons.includes('validated_matching_profile_required:chicken'));
  }
});

test('rejects preparation-state mismatch and missing nutrient values', () => {
  const wrongState = profile({ preparation_state: 'raw' });
  const wrongStateLine = { ...line('chicken', 100, wrongState), preparation_state: 'cooked' };
  const missingNutrient = profile({ carbs_g: Number.NaN });
  for (const [ingredient] of [[wrongStateLine], [line('chicken', 100, missingNutrient)]] as const) {
    const result = calculateValidatedRecipeIngredientNutrition({
      recipe_id: 'recipe-5', recipe_state_version: 1, servings: 1, ingredients: [ingredient],
    });
    assert.equal(result.status, 'insufficient_evidence');
  }
});

test('rejects duplicate ingredient IDs and invalid servings', () => {
  const duplicate = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-6', recipe_state_version: 1, servings: 1,
    ingredients: [line('same', 100), line('same', 50)],
  });
  assert.equal(duplicate.status, 'insufficient_evidence');
  const servings = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-6', recipe_state_version: 1, servings: 0,
    ingredients: [line('chicken', 100)],
  });
  assert.equal(servings.status, 'insufficient_evidence');
});

test('does not calculate weighed portions without a measured batch mass', () => {
  const result = calculateValidatedRecipeIngredientNutrition({
    recipe_id: 'recipe-7', recipe_state_version: 1, servings: 1,
    ingredients: [line('chicken', 100)],
  });
  assert.deepEqual(calculateValidatedWeighedPortionNutrition(result, 100), {
    status: 'insufficient_evidence', reasons: ['measured_validated_batch_required'],
  });
});
