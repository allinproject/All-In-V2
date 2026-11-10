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
    const match = nutrients.find((entry: any) =>
      Number(entry?.nutrientId ?? entry?.nutrient?.id) === id &&
      String(entry?.unitName ?? entry?.nutrient?.unitName ?? '').toUpperCase() === unit
    );
    if (!match) continue;
    const value = nonnegative(match.value ?? match.amount);
    if (value !== null) return value;
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
