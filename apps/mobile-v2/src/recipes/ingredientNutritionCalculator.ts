/**
 * V2 ingredient-first nutrition calculator.
 * Pure deterministic arithmetic only: food identity, quantity conversion and
 * source review must be resolved by callers before a profile is supplied.
 * Recipe-level nutrition is derived output and is never written to catalog rows.
 */
export type IngredientNutritionProfile = {
  profile_key: string;
  preparation_state: string;
  basis_g: number | null;
  basis_unit: 'g' | 'each' | 'count' | 'serving' | 'unknown';
  basis_quantity?: number;
  serving_name?: string;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  status: 'validated' | 'estimated' | 'unknown';
  provenance: unknown;
};

export type RecipeIngredientLine = {
  ingredient_id: string;
  profile_key: string;
  preparation_state: string;
  quantity_g?: number;
  quantity_each?: number;
  profile: IngredientNutritionProfile | undefined;
};

export type NutritionTotals = Readonly<{
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}>;

export type ValidatedRecipeNutrition = {
  status: 'validated';
  recipe_id: string;
  recipe_state_version: string;
  servings: number;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  batch_totals: NutritionTotals;
  measured_edible_weight_g: number | null;
  per_100g: NutritionTotals | null;
  ingredient_count: number;
  provenance: readonly { ingredient_id: string; profile_key: string; source: unknown }[];
};

export type InsufficientNutritionEvidence = {
  status: 'insufficient_evidence';
  recipe_id: string;
  recipe_state_version: string;
  reasons: readonly string[];
};

export type RecipeNutritionResult = ValidatedRecipeNutrition | InsufficientNutritionEvidence;

const cleanId = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const normalizeVersion = (value: string | number): string => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' ? value.trim() : '';
};
const isNonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isPositive = (value: unknown): value is number => isNonnegative(value) && value > 0;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function fail(recipeId: string, recipeVersion: string, reasons: string[]): InsufficientNutritionEvidence {
  return { status: 'insufficient_evidence', recipe_id: recipeId, recipe_state_version: recipeVersion, reasons };
}

/**
 * Calculate exact ingredient totals and per-serving nutrition from reviewed
 * ingredient profiles. No identity matching, guesses, API calls or writes occur.
 */
export function calculateValidatedRecipeIngredientNutrition(input: {
  recipe_id: string;
  recipe_state_version: string | number;
  servings: number;
  /** Actual measured edible cooked/prepared batch mass; never inferred. */
  measured_edible_weight_g?: number | null;
  ingredients: readonly RecipeIngredientLine[];
}): RecipeNutritionResult {
  const recipeId = cleanId(input?.recipe_id);
  const recipeVersion = normalizeVersion(input?.recipe_state_version);
  const reasons: string[] = [];

  if (!recipeId || !recipeVersion) reasons.push('target_identity_required');
  if (!Number.isSafeInteger(input?.servings) || input.servings < 1) reasons.push('valid_servings_required');
  if (!Array.isArray(input?.ingredients) || input.ingredients.length === 0) reasons.push('ingredient_lines_required');
  if (input.measured_edible_weight_g != null && !isPositive(input.measured_edible_weight_g)) {
    reasons.push('valid_measured_edible_weight_required');
  }

  const seen = new Set<string>();
  const totals = { calories_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const provenance: { ingredient_id: string; profile_key: string; source: unknown }[] = [];

  for (const [index, line] of (Array.isArray(input?.ingredients) ? input.ingredients : []).entries()) {
    const id = cleanId(line?.ingredient_id);
    const profileKey = cleanId(line?.profile_key);
    const preparationState = cleanId(line?.preparation_state);
    const profile = line?.profile;

    if (!id || seen.has(id)) {
      reasons.push('missing_or_duplicate_ingredient_identity:' + index);
      continue;
    }
    seen.add(id);

    if (!profileKey || !preparationState) {
      reasons.push('invalid_ingredient_quantity_or_state:' + id);
      continue;
    }

    const isCountBasis = profile?.basis_unit === 'each';
    const validMass = !isCountBasis && isPositive(line.quantity_g) && line.quantity_each == null;
    const validCount = isCountBasis && isPositive(line.quantity_each) && line.quantity_g == null;
    if (!validMass && !validCount) {
      reasons.push('invalid_ingredient_quantity_or_state:' + id);
      continue;
    }

    const validProfile = Boolean(
      profile &&
      profile.status === 'validated' &&
      profileKey === cleanId(profile.profile_key) &&
      preparationState === cleanId(profile.preparation_state) &&
      (isCountBasis
        ? profile.basis_g == null && profile.basis_quantity === 1 && Boolean(cleanId(profile.serving_name))
        : isPositive(profile.basis_g) && profile.basis_unit === 'g') &&
      isNonnegative(profile.calories_kcal) &&
      isNonnegative(profile.protein_g) &&
      isNonnegative(profile.carbs_g) &&
      isNonnegative(profile.fat_g) &&
      profile.provenance !== null &&
      profile.provenance !== undefined &&
      !(typeof profile.provenance === 'string' && !profile.provenance.trim())
    );

    if (!validProfile || !profile) {
      reasons.push('validated_matching_profile_required:' + id);
      continue;
    }

    const multiplier = isCountBasis
      ? (line.quantity_each as number) / (profile.basis_quantity as number)
      : (line.quantity_g as number) / (profile.basis_g as number);

    totals.calories_kcal += profile.calories_kcal * multiplier;
    totals.protein_g += profile.protein_g * multiplier;
    totals.carbs_g += profile.carbs_g * multiplier;
    totals.fat_g += profile.fat_g * multiplier;
    provenance.push({ ingredient_id: id, profile_key: profileKey, source: profile.provenance });
  }

  if (Object.values(totals).some(value => !Number.isFinite(value))) {
    reasons.push('finite_batch_nutrition_required');
  }
  if (reasons.length > 0) return fail(recipeId, recipeVersion, reasons);

  const batchTotals: NutritionTotals = {
    calories_kcal: round3(totals.calories_kcal),
    protein_g: round3(totals.protein_g),
    carbs_g: round3(totals.carbs_g),
    fat_g: round3(totals.fat_g),
  };
  const edibleWeight = input.measured_edible_weight_g ?? null;
  const per100g: NutritionTotals | null = edibleWeight
    ? {
        calories_kcal: round3(totals.calories_kcal / edibleWeight * 100),
        protein_g: round3(totals.protein_g / edibleWeight * 100),
        carbs_g: round3(totals.carbs_g / edibleWeight * 100),
        fat_g: round3(totals.fat_g / edibleWeight * 100),
      }
    : null;

  return {
    status: 'validated',
    recipe_id: recipeId,
    recipe_state_version: recipeVersion,
    servings: input.servings,
    calories_kcal: round3(totals.calories_kcal / input.servings),
    protein_g: round3(totals.protein_g / input.servings),
    carbs_g: round3(totals.carbs_g / input.servings),
    fat_g: round3(totals.fat_g / input.servings),
    batch_totals: batchTotals,
    measured_edible_weight_g: edibleWeight,
    per_100g: per100g,
    ingredient_count: input.ingredients.length,
    provenance,
  };
}

/** Calculate a weighed serving from a validated batch and its measured edible mass. */
export function calculateValidatedWeighedPortionNutrition(
  batch: RecipeNutritionResult,
  portionWeightG: number,
):
  | { status: 'validated'; calories_kcal: number; protein_g: number; carbs_g: number; fat_g: number; portion_weight_g: number }
  | { status: 'insufficient_evidence'; reasons: readonly string[] } {
  if (batch.status !== 'validated' || !isPositive(batch.measured_edible_weight_g)) {
    return { status: 'insufficient_evidence', reasons: ['measured_validated_batch_required'] };
  }
  if (!isPositive(portionWeightG) || portionWeightG > batch.measured_edible_weight_g) {
    return { status: 'insufficient_evidence', reasons: ['valid_measured_portion_weight_required'] };
  }

  const factor = portionWeightG / batch.measured_edible_weight_g;
  const scale = (value: number) => round3(value * factor);
  return {
    status: 'validated',
    portion_weight_g: portionWeightG,
    calories_kcal: scale(batch.batch_totals.calories_kcal),
    protein_g: scale(batch.batch_totals.protein_g),
    carbs_g: scale(batch.batch_totals.carbs_g),
    fat_g: scale(batch.batch_totals.fat_g),
  };
}
