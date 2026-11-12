import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * USDA FoodData Central generic-food candidate normalization.
 *
 * Pure boundary adapter only: returned values are unreviewed candidates.
 * A caller must confirm the exact food identity and preparation state before
 * constructing a calculator-ready ingredient profile.
 */

export type FdcGenericDataType = 'Foundation' | 'SR Legacy';

export type FdcGenericIngredientCandidate = {
  source: 'usda_fdc';
  source_id: string;
  data_type: FdcGenericDataType;
  food_description: string;
  nutrition_basis: '100g';
  portion_label: '100 g';
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  saturated_fat_g: number | null;
  sodium_mg: number | null;
  usable: boolean;
  source_quality: 'usda_reference_unreviewed';
  source_license: 'USDA FoodData Central / CC0 1.0';
  review_required: true;
  retrieved_at: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nonnegative(value: unknown): number | null {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !value.trim())
  ) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nutrientValue(
  nutrients: readonly any[],
  ids: readonly number[],
  unit: string,
): number | null {
  for (const id of ids) {
    const matches = nutrients.filter((entry: any) =>
      Number(entry?.nutrientId ?? entry?.nutrient?.id) === id &&
      String(entry?.unitName ?? entry?.nutrient?.unitName ?? '').toUpperCase() === unit
    );
    if (!matches.length) continue;
    // Source records can contain multiple observations of the SAME nutrient
    // and unit. Choosing the first makes nutrition depend on input ordering.
    // Without an explicit reviewed aggregation policy, conflicting or invalid
    // observations are unknown rather than a made-up single value.
    const values = matches.map((entry: any) => nonnegative(entry.value ?? entry.amount));
    if (values.some(value => value === null) ||
        values.some(value => value !== values[0])) return null;
    return values[0];
  }
  return null;
}

/** Normalize a USDA generic Foundation/SR Legacy search result to per-100g basis. */
export function normalizeFdcGenericFood(
  raw: unknown,
  retrievedAt: string,
): FdcGenericIngredientCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const food = raw as Record<string, any>;
  const id = Number(food.fdcId);
  const description = text(food.description);
  const dataType = food.dataType;
  if (
    !Number.isSafeInteger(id) || id <= 0 || !description ||
    (dataType !== 'Foundation' && dataType !== 'SR Legacy') ||
    !Number.isFinite(Date.parse(retrievedAt))
  ) return null;

  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const calories = nutrientValue(
    nutrients,
    dataType === 'Foundation' ? [2048, 2047, 1008] : [1008, 2048, 2047],
    'KCAL',
  );
  const protein = nutrientValue(nutrients, [1003], 'G');
  const carbs = nutrientValue(nutrients, [1005], 'G');
  const fat = nutrientValue(nutrients, [1004], 'G');
  const fiber = nutrientValue(nutrients, [1079], 'G');
  const saturatedFat = nutrientValue(nutrients, [1258], 'G');
  const sodium = nutrientValue(nutrients, [1093], 'MG');

  return {
    source: 'usda_fdc',
    source_id: String(id),
    data_type: dataType,
    food_description: description,
    nutrition_basis: '100g',
    portion_label: '100 g',
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    fiber_g: fiber,
    saturated_fat_g: saturatedFat,
    sodium_mg: sodium,
    usable: calories !== null && protein !== null && carbs !== null && fat !== null,
    source_quality: 'usda_reference_unreviewed',
    source_license: 'USDA FoodData Central / CC0 1.0',
    review_required: true,
    retrieved_at: retrievedAt,
  };
}

/** A search result is never a reviewed calculator profile by itself. */
export function canUseFdcCandidateForReviewedProfile(
  candidate: FdcGenericIngredientCandidate,
  review: { identityConfirmed: boolean; preparationStateConfirmed: boolean },
): boolean {
  return candidate.source === 'usda_fdc' &&
    candidate.usable === true &&
    candidate.review_required === true &&
    review.identityConfirmed === true &&
    review.preparationStateConfirmed === true;
}


/** Parse the V2 Edge Function's already-normalized, provenance-bearing candidate. */
export function parseFdcGenericIngredientCandidate(raw: unknown): FdcGenericIngredientCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const sourceId = typeof item.source_id === 'string' ? item.source_id.trim() : '';
  const description = typeof item.food_description === 'string' ? item.food_description.trim() : '';
  const dataType = item.data_type;
  const retrievedAt = typeof item.retrieved_at === 'string' ? item.retrieved_at : '';
  if (
    item.source !== 'usda_fdc' ||
    !/^\d{1,12}$/.test(sourceId) || Number(sourceId) <= 0 ||
    !description ||
    (dataType !== 'Foundation' && dataType !== 'SR Legacy') ||
    item.nutrition_basis !== '100g' ||
    item.portion_label !== '100 g' ||
    item.source_quality !== 'usda_reference_unreviewed' ||
    item.source_license !== 'USDA FoodData Central / CC0 1.0' ||
    item.review_required !== true ||
    !Number.isFinite(Date.parse(retrievedAt))
  ) return null;

  const calories = nonnegative(item.calories);
  const protein = nonnegative(item.protein_g);
  const carbs = nonnegative(item.carbs_g);
  const fat = nonnegative(item.fat_g);
  const fiber = nonnegative(item.fiber_g);
  const saturatedFat = nonnegative(item.saturated_fat_g);
  const sodium = nonnegative(item.sodium_mg);
  const usable = calories !== null && protein !== null && carbs !== null && fat !== null;
  if (item.usable !== usable) return null;

  return {
    source: 'usda_fdc',
    source_id: sourceId,
    data_type: dataType,
    food_description: description,
    nutrition_basis: '100g',
    portion_label: '100 g',
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    fiber_g: fiber,
    saturated_fat_g: saturatedFat,
    sodium_mg: sodium,
    usable,
    source_quality: 'usda_reference_unreviewed',
    source_license: 'USDA FoodData Central / CC0 1.0',
    review_required: true,
    retrieved_at: retrievedAt,
  };
}

export type FdcGenericIngredientSearch = {
  provider: 'usda_fdc';
  retrieved_at: string;
  review_required: true;
  results: FdcGenericIngredientCandidate[];
};

/** Calls only the authenticated V2 Edge Function. USDA keys never enter mobile code. */
export async function searchV2FdcGenericIngredients(
  client: SupabaseClient,
  rawQuery: string,
): Promise<FdcGenericIngredientSearch> {
  const query = String(rawQuery ?? '').replace(/\s+/g, ' ').trim();
  if (query.length < 2 || query.length > 80) {
    throw new Error('Enter a 2–80 character ingredient name.');
  }
  const { data, error } = await client.functions.invoke('v2-search-usda-ingredients', {
    body: { action: 'search', query },
  });
  if (error) throw error;
  if (
    !data || typeof data !== 'object' ||
    data.kind !== 'generic_ingredient_candidates' ||
    data.provider !== 'usda_fdc' ||
    data.source_quality !== 'usda_reference_unreviewed' ||
    data.source_license !== 'USDA FoodData Central / CC0 1.0' ||
    data.review_required !== true ||
    !Array.isArray(data.results) ||
    typeof data.retrieved_at !== 'string' ||
    !Number.isFinite(Date.parse(data.retrieved_at))
  ) {
    throw new Error('V2 USDA ingredient lookup returned an invalid candidate response.');
  }

  const results: FdcGenericIngredientCandidate[] = [];
  const sourceIds = new Set<string>();
  for (const raw of data.results.slice(0, 20)) {
    const candidate = parseFdcGenericIngredientCandidate(raw);
    if (!candidate) continue;
    if (sourceIds.has(candidate.source_id)) {
      throw new Error('V2 USDA ingredient lookup returned a duplicate FDC source ID.');
    }
    sourceIds.add(candidate.source_id);
    results.push(candidate);
  }

  return {
    provider: 'usda_fdc',
    retrieved_at: data.retrieved_at,
    review_required: true,
    results,
  };
}

/** Refreshes one generic FDC record by its source ID using the V2 Edge Function. */
export async function fetchV2FdcGenericIngredientDetail(
  client: SupabaseClient,
  sourceId: string,
): Promise<FdcGenericIngredientCandidate> {
  const id = String(sourceId ?? '').trim();
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) throw new Error('A valid USDA FDC source ID is required.');
  const { data, error } = await client.functions.invoke('v2-search-usda-ingredients', {
    body: { action: 'detail', fdc_id: id },
  });
  if (error) throw error;
  if (
    !data || typeof data !== 'object' ||
    data.kind !== 'generic_ingredient_candidate' ||
    data.provider !== 'usda_fdc' ||
    data.review_required !== true
  ) {
    throw new Error('V2 USDA ingredient detail returned an invalid candidate response.');
  }
  const candidate = parseFdcGenericIngredientCandidate(data.result);
  if (!candidate || candidate.source_id !== id) {
    throw new Error('V2 USDA ingredient detail did not match the requested FDC source ID.');
  }
  return candidate;
}
