import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRecipeFromLocalCatalog,
  resolveLocalIngredient,
  type LocalIngredientCatalog,
  type IngredientRequest,
} from './localIngredientProfiles.ts';

const catalog = (): LocalIngredientCatalog => ({
  ingredients: [{ id: 'chicken-v2', status: 'active' }, { id: 'egg-v2', status: 'active' }],
  aliases: [
    { ingredient_id: 'chicken-v2', normalized_alias: 'chicken breast', locale: 'en', preparation_state: null, status: 'active' },
    { ingredient_id: 'egg-v2', normalized_alias: 'large egg', locale: 'en', preparation_state: 'as_sold', status: 'active' },
  ],
  profiles: [
    { id: 'chicken-cooked-v1', ingredient_id: 'chicken-v2', preparation_state: 'cooked',
      basis_unit: 'g', basis_quantity: 100, basis_label: '100 g', profile_revision: 1,
      review_status: 'calculation_ready', is_default: true, source_record_id: 'fdc-123' },
    { id: 'chicken-raw-candidate', ingredient_id: 'chicken-v2', preparation_state: 'raw',
      basis_unit: 'g', basis_quantity: 100, basis_label: '100 g', profile_revision: 1,
      review_status: 'candidate', is_default: false, source_record_id: 'fdc-789' },
    { id: 'egg-item', ingredient_id: 'egg-v2', preparation_state: 'as_sold',
      basis_unit: 'each', basis_quantity: 1, basis_label: 'one large egg', profile_revision: 2,
      review_status: 'calculation_ready', is_default: true, source_record_id: 'fdc-egg' },
  ],
  nutrients: [
    { profile_id: 'chicken-cooked-v1', nutrient_code: 'energy_kcal', amount: 165 },
    { profile_id: 'chicken-cooked-v1', nutrient_code: 'protein_g', amount: 31 },
    { profile_id: 'chicken-cooked-v1', nutrient_code: 'carbohydrate_g', amount: 0 },
    { profile_id: 'chicken-cooked-v1', nutrient_code: 'total_fat_g', amount: 3.6 },
    { profile_id: 'egg-item', nutrient_code: 'energy_kcal', amount: 72 },
    { profile_id: 'egg-item', nutrient_code: 'protein_g', amount: 6.3 },
    { profile_id: 'egg-item', nutrient_code: 'carbohydrate_g', amount: 0.4 },
    { profile_id: 'egg-item', nutrient_code: 'total_fat_g', amount: 4.8 },
  ],
});
const request = (changes: Partial<IngredientRequest> = {}): IngredientRequest => ({
  line_id: 'chicken-line', label: ' CHICKEN  BREAST ', preparation_state: 'cooked',
  quantity_g: 200, ...changes,
});

test('exact unique local alias calculates with reviewed profile provenance and zero provider dependency', () => {
  const resolved = resolveLocalIngredient(catalog(), request());
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.ingredient_id, 'chicken-v2');
  assert.deepEqual(resolved.line?.profile?.provenance, {
    ingredient_id: 'chicken-v2', profile_id: 'chicken-cooked-v1', profile_revision: 1,
    source_record_id: 'fdc-123',
  });
  const result = calculateRecipeFromLocalCatalog({
    catalog: catalog(), recipe_id: 'recipe-a', recipe_state_version: '7',
    servings: 2, ingredients: [request()],
  });
  assert.equal(result.status, 'validated');
  if (result.status === 'validated') {
    assert.equal(result.calories_kcal, 165);
    assert.equal(result.protein_g, 31);
    assert.equal(result.carbs_g, 0); // confirmed zero nutrient is not missing
  }
});

test('ambiguous exact aliases fail closed, never choose first result', () => {
  const rows = catalog();
  rows.aliases = [...rows.aliases, {
    ingredient_id: 'egg-v2', normalized_alias: 'chicken breast', locale: 'en',
    preparation_state: null, status: 'active',
  }];
  assert.equal(resolveLocalIngredient(rows, request()).status, 'ambiguous');
});

test('missing alias and retired identity cannot validate a profile', () => {
  assert.equal(resolveLocalIngredient(catalog(), request({ label: 'unknown' })).status, 'missing');
  const rows = catalog();
  rows.ingredients = [{ id: 'chicken-v2', status: 'retired' }, ...rows.ingredients.slice(1)];
  assert.equal(resolveLocalIngredient(rows, request()).status, 'missing');
});

test('raw/cooked state mismatch never borrows cooked nutrition or candidate raw data', () => {
  assert.equal(resolveLocalIngredient(catalog(), request({ preparation_state: 'raw' })).status, 'review_required');
  assert.equal(resolveLocalIngredient(catalog(), request({ preparation_state: 'dry' })).status, 'state_mismatch');
});

test('volume basis requires separately reviewed conversion, never assumes ml equals grams', () => {
  const rows = catalog();
  rows.profiles = rows.profiles.map(p => p.id === 'chicken-cooked-v1'
    ? { ...p, basis_unit: 'ml' as const, basis_quantity: 100, basis_label: '100 mL' } : p);
  assert.equal(resolveLocalIngredient(rows, request()).status, 'conversion_required');
});

test('exact item nutrition is not treated as mass', () => {
  const result = resolveLocalIngredient(catalog(), {
    line_id: 'egg-line', label: 'large egg', preparation_state: 'as_sold', quantity_each: 2,
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.line?.profile?.basis_unit, 'each');
  const invalid = resolveLocalIngredient(catalog(), {
    line_id: 'egg-line', label: 'large egg', preparation_state: 'as_sold', quantity_g: 100,
  });
  assert.equal(invalid.status, 'invalid_quantity');
});

test('unknown nutrients are not zero, and duplicate nutrient facts are not silently selected', () => {
  const missing = catalog();
  missing.nutrients = missing.nutrients.filter(n =>
    !(n.profile_id === 'chicken-cooked-v1' && n.nutrient_code === 'total_fat_g'));
  assert.equal(resolveLocalIngredient(missing, request()).status, 'incomplete_nutrients');
  const duplicate = catalog();
  duplicate.nutrients = [...duplicate.nutrients, {
    profile_id: 'chicken-cooked-v1', nutrient_code: 'energy_kcal', amount: 999,
  }];
  assert.equal(resolveLocalIngredient(duplicate, request()).status, 'incomplete_nutrients');
});

test('competing ready defaults fail closed until the catalog owner chooses one', () => {
  const rows = catalog();
  rows.profiles = [...rows.profiles, {
    ...rows.profiles[0], id: 'chicken-cooked-v2', profile_revision: 2,
  }];
  assert.equal(resolveLocalIngredient(rows, request()).status, 'profile_conflict');
});

test('duplicate profile IDs anywhere in catalog cannot share another food nutrition', () => {
  const rows = catalog();
  rows.profiles = [
    ...rows.profiles,
    { ...rows.profiles[0], ingredient_id: 'egg-v2', preparation_state: 'raw',
      is_default: false },
  ];
  assert.equal(resolveLocalIngredient(rows, request()).status, 'profile_conflict');
  const calculated = calculateRecipeFromLocalCatalog({
    catalog: rows, recipe_id: 'recipe-with-bad-profile', recipe_state_version: '1',
    servings: 2, ingredients: [request()],
  });
  assert.equal(calculated.status, 'insufficient_evidence');
  if (calculated.status === 'insufficient_evidence') {
    assert.ok(calculated.reasons.includes('local_ingredient_profile_conflict:chicken-line'));
  }
});

test('reviewed status alone does not publish calculation-ready facts', () => {
  const rows = catalog();
  rows.profiles = rows.profiles.map(p => p.id === 'chicken-cooked-v1'
    ? { ...p, review_status: 'reviewed' as const } : p);
  assert.equal(resolveLocalIngredient(rows, request()).status, 'review_required');
});

test('recalculate is deterministic for portions, and incomplete entries block the entire recipe', () => {
  const input = {
    catalog: catalog(), recipe_id: 'recipe-a', recipe_state_version: '7', servings: 2,
    ingredients: [request()],
  };
  const first = calculateRecipeFromLocalCatalog(input);
  const again = calculateRecipeFromLocalCatalog(input);
  assert.deepEqual(again, first);
  const changed = calculateRecipeFromLocalCatalog({ ...input, servings: 4 });
  assert.equal(changed.status, 'validated');
  if (first.status === 'validated' && changed.status === 'validated') {
    assert.equal(changed.calories_kcal, first.calories_kcal / 2);
  }
  const incomplete = calculateRecipeFromLocalCatalog({
    ...input, ingredients: [request(), request({
      line_id: 'missing-line', label: 'imaginary food',
    })],
  });
  assert.equal(incomplete.status, 'insufficient_evidence');
  if (incomplete.status === 'insufficient_evidence') {
    assert.ok(incomplete.reasons.includes('local_ingredient_missing:missing-line'));
  }
});

test('untrusted catalog shape and corrupted profile metadata cannot validate nutrition', () => {
  assert.equal(resolveLocalIngredient(null as any, request()).status, 'missing');
  assert.equal(resolveLocalIngredient({ ...catalog(), profiles: null } as any, request()).status, 'missing');

  const malformedProfileId = catalog();
  malformedProfileId.profiles = malformedProfileId.profiles.map(p =>
    p.id === 'chicken-cooked-v1' ? { ...p, id: 42 as any } : p);
  assert.equal(resolveLocalIngredient(malformedProfileId, request()).status, 'profile_conflict');

  const corruptSource = catalog();
  corruptSource.profiles = corruptSource.profiles.map(p =>
    p.id === 'chicken-cooked-v1' ? { ...p, source_record_id: { id: 'fdc-123' } as any } : p);
  assert.equal(resolveLocalIngredient(corruptSource, request()).status, 'review_required');

  const corruptItem = catalog();
  corruptItem.profiles = corruptItem.profiles.map(p =>
    p.id === 'egg-item' ? { ...p, basis_label: 12 as any } : p);
  assert.equal(resolveLocalIngredient(corruptItem, {
    line_id: 'egg-line', label: 'large egg', preparation_state: 'as_sold', quantity_each: 2,
  }).status, 'invalid_quantity');

  const nullNutrient = catalog();
  nullNutrient.nutrients = [...nullNutrient.nutrients, null as any];
  assert.equal(resolveLocalIngredient(nullNutrient, request()).status, 'ready');
});

test('malformed ingredient request identities or labels fail closed without throwing', () => {
  for (const changes of [
    { line_id: null as any },
    { preparation_state: 12 as any },
    { ingredient_id: 123 as any },
    { label: { name: 'chicken breast' } as any },
  ]) {
    const result = resolveLocalIngredient(catalog(), request(changes));
    assert.equal(result.status, 'missing');
  }
});
