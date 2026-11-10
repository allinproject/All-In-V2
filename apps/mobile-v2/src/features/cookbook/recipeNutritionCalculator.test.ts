import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRecipeIngredientNutrition,
  calculateWeighedRecipePortionNutrition,
  type RecipeIngredientNutritionLine,
  type RecipeIngredientNutritionProfile,
} from './recipeNutritionCalculator.ts';

const profile = (overrides: Partial<RecipeIngredientNutritionProfile> = {}): RecipeIngredientNutritionProfile => ({
  profile_key: 'chicken-cooked',
  preparation_state: 'cooked',
  basis_g: 100,
  basis_unit: 'g',
  calories_kcal: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
  status: 'validated',
  provenance: { provider: 'usda_fdc', source_id: '12345', review: 'identity_and_state_confirmed' },
  ...overrides,
});
const line = (
  id: string,
  amount: number,
  p = profile(),
): RecipeIngredientNutritionLine => ({
  ingredient_id: id,
  profile_key: p.profile_key,
  preparation_state: p.preparation_state,
  quantity_g: amount,
  profile: p,
});
const calculate = (ingredients: RecipeIngredientNutritionLine[], overrides: Record<string, unknown> = {}) =>
  calculateRecipeIngredientNutrition({
    recipe_id: 'recipe-1',
    recipe_state_version: 'rev-7',
    servings: 1,
    ingredients,
    ...(overrides as object),
  });

test('calculates ingredient totals and divides by current serving count', () => {
  const result = calculate(
    [line('chicken', 200), line('rice', 100, profile({
      profile_key: 'rice-cooked', calories_kcal: 130, protein_g: 2.7, carbs_g: 28.2, fat_g: 0.3,
    }))],
    { servings: 2 },
  );
  assert.equal(result.status, 'validated');
  if (result.status !== 'validated') return;
  assert.equal(result.calories_kcal, 230);
  assert.equal(result.protein_g, 32.35);
  assert.equal(result.carbs_g, 14.1);
  assert.equal(result.fat_g, 3.75);
  assert.equal(result.batch_totals.calories_kcal, 460);
  assert.equal(result.ingredient_count, 2);
  assert.equal(result.provenance.length, 2);
});

test('supports exact one-unit basis without pretending one item is one gram', () => {
  const egg = profile({
    profile_key: 'egg-large',
    preparation_state: 'as_sold',
    basis_g: null,
    basis_unit: 'each',
    basis_quantity: 1,
    serving_name: 'large egg',
    calories_kcal: 72,
    protein_g: 6.3,
    carbs_g: 0.4,
    fat_g: 4.8,
  });
  const result = calculate([{
    ingredient_id: 'eggs',
    profile_key: egg.profile_key,
    preparation_state: egg.preparation_state,
    quantity_each: 2,
    profile: egg,
  }]);
  assert.equal(result.status, 'validated');
  if (result.status === 'validated') assert.equal(result.calories_kcal, 144);
});

test('rejects unreviewed profiles and preparation-state mismatch', () => {
  const estimated = profile({ status: 'estimated' });
  assert.equal(calculate([line('chicken', 100, estimated)]).status, 'insufficient_evidence');
  const cooked = profile();
  assert.equal(calculate([{
    ...line('chicken', 100, cooked),
    preparation_state: 'raw',
  }]).status, 'insufficient_evidence');
});

test('rejects missing and unknown nutrients instead of coercing them to zero', () => {
  const missingProtein = profile({ protein_g: Number.NaN });
  const result = calculate([line('chicken', 100, missingProtein)]);
  assert.equal(result.status, 'insufficient_evidence');
  if (result.status !== 'validated') assert.ok(result.reasons.includes('validated_matching_profile_required:chicken'));
});

test('rejects ambiguous quantity shapes and count without exact item basis', () => {
  const p = profile();
  const both = { ...line('chicken', 100, p), quantity_each: 1 };
  assert.equal(calculate([both]).status, 'insufficient_evidence');
  const countWithoutBasis = profile({ basis_unit: 'each', basis_g: null, basis_quantity: 2, serving_name: 'piece' });
  assert.equal(calculate([{
    ingredient_id: 'piece', profile_key: countWithoutBasis.profile_key,
    preparation_state: countWithoutBasis.preparation_state, quantity_each: 1, profile: countWithoutBasis,
  }]).status, 'insufficient_evidence');
});

test('rejects duplicate ingredient identities, invalid servings and empty lines', () => {
  assert.equal(calculate([line('chicken', 100), line('chicken', 50)]).status, 'insufficient_evidence');
  assert.equal(calculate([line('chicken', 100)], { servings: 0 }).status, 'insufficient_evidence');
  assert.equal(calculate([]).status, 'insufficient_evidence');
});

test('calculates per-100g only from an actually measured edible batch mass', () => {
  const withoutMass = calculate([line('chicken', 200)], { measured_edible_weight_g: null });
  assert.equal(withoutMass.status, 'validated');
  if (withoutMass.status === 'validated') assert.equal(withoutMass.per_100g, null);
  const withMass = calculate([line('chicken', 200)], { measured_edible_weight_g: 150 });
  assert.equal(withMass.status, 'validated');
  if (withMass.status === 'validated') assert.equal(withMass.per_100g?.calories_kcal, 220);
});

test('rejects invalid measured batch mass', () => {
  assert.equal(calculate([line('chicken', 100)], { measured_edible_weight_g: 0 }).status, 'insufficient_evidence');
});

test('scales a weighed portion from frozen validated batch totals and measured mass', () => {
  const batch = calculate([line('chicken', 200)], { servings: 4, measured_edible_weight_g: 150 });
  assert.equal(batch.status, 'validated');
  const portion = calculateWeighedRecipePortionNutrition(batch, 75);
  assert.deepEqual(portion, {
    status: 'validated',
    portion_weight_g: 75,
    calories_kcal: 165,
    protein_g: 31,
    carbs_g: 0,
    fat_g: 3.6,
  });
});

test('does not calculate weighed portions without measured validated batch mass', () => {
  const batch = calculate([line('chicken', 100)]);
  assert.deepEqual(calculateWeighedRecipePortionNutrition(batch, 50), {
    status: 'insufficient_evidence',
    reasons: ['measured_validated_batch_required'],
  });
  const measured = calculate([line('chicken', 100)], { measured_edible_weight_g: 50 });
  assert.deepEqual(calculateWeighedRecipePortionNutrition(measured, 51), {
    status: 'insufficient_evidence',
    reasons: ['valid_measured_portion_weight_required'],
  });
});

test('refuses non-finite derived per-100g nutrition from an implausibly tiny measured batch', () => {
  const result = calculate([line('chicken', 100)], { measured_edible_weight_g: Number.MIN_VALUE });
  assert.equal(result.status, 'insufficient_evidence');
  if (result.status === 'insufficient_evidence') {
    assert.ok(result.reasons.includes('finite_derived_nutrition_required'));
  }
});

test('refuses overflow in total nutrition accumulated from individually finite profiles', () => {
  const large = profile({ basis_g: 1, calories_kcal: 1e308 });
  const result = calculate([line('large-a', 1, large), line('large-b', 1, large)]);
  assert.equal(result.status, 'insufficient_evidence');
  if (result.status === 'insufficient_evidence') {
    assert.ok(result.reasons.includes('finite_batch_nutrition_required'));
  }
});

test('empty or malformed source provenance cannot validate a nutrition profile', () => {
  for (const provenance of [{}, [], '', '  ', null, 42]) {
    const candidate = profile({ provenance });
    const result = calculate([line('chicken', 100, candidate)]);
    assert.equal(result.status, 'insufficient_evidence');
    if (result.status === 'insufficient_evidence') {
      assert.ok(result.reasons.includes('validated_matching_profile_required:chicken'));
    }
  }
  assert.equal(calculate([line('chicken', 100)]).status, 'validated');
});
