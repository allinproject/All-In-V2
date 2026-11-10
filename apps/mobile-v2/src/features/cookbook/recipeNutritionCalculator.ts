/**
 * V2 Cookbook ingredient-first nutrition arithmetic.
 *
 * Pure deterministic arithmetic only: no provider lookup, food matching,
 * serving assumptions, yield inference, persistence or network access.
 * Callers must supply one reviewed ingredient profile per line with an exact
 * preparation state and measured quantity/basis.
 */

export type RecipeIngredientNutritionProfile = {
  profile_key: string;
  preparation_state: string;
  basis_g: number | null;
  basis_unit: 'g' | 'each' | 'count' | 'serving' | 'unknown';
  /** Counted products are supported only for one exact representative unit. */
  basis_quantity?: number;
  serving_name?: string;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  status: 'validated' | 'estimated' | 'unknown';
  provenance: unknown;
};

export type RecipeIngredientNutritionLine = {
  ingredient_id: string;
  profile_key: string;
  preparation_state: string;
  quantity_g?: number;
  quantity_each?: number;
  profile: RecipeIngredientNutritionProfile | undefined;
};

export type RecipeNutritionTotals = Readonly<{
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}>;

export type RecipeIngredientNutritionCalculation =
  | {
      status: 'validated';
      recipe_id: string;
      recipe_state_version: string;
      servings: number;
      calories_kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      batch_totals: RecipeNutritionTotals;
      measured_edible_weight_g: number | null;
      per_100g: RecipeNutritionTotals | null;
      ingredient_count: number;
      provenance: readonly {
        ingredient_id: string;
        profile_key: string;
        source: unknown;
      }[];
    }
  | {
      status: 'insufficient_evidence';
      recipe_id: string;
      recipe_state_version: string;
      reasons: readonly string[];
    };

const cleanId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeVersion = (value: unknown): string => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : '';
};

const validNonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const validPositive = (value: unknown): value is number =>
  validNonnegative(value) && value > 0;

/**
 * Calculate validated batch and per-serving nutrition.
 *
 * This function intentionally refuses estimated/unknown profiles, mismatched
 * preparation states, ambiguous units, duplicate ingredient IDs, and
 * unmeasured counts. Unknown nutrients must stay unknown, not become zero.
 */
export function calculateRecipeIngredientNutrition(input: {
  recipe_id: string;
  recipe_state_version: string | number;
  servings: number;
  /** Actual measured edible batch mass; never derive it from raw ingredient mass. */
  measured_edible_weight_g?: number | null;
  ingredients: readonly RecipeIngredientNutritionLine[];
}): RecipeIngredientNutritionCalculation {
  const recipeId = cleanId(input?.recipe_id);
  const recipeVersion = normalizeVersion(input?.recipe_state_version);
  const reasons: string[] = [];

  if (!recipeId || !recipeVersion) reasons.push('target_identity_required');
  if (!Number.isSafeInteger(input?.servings) || input.servings < 1) {
    reasons.push('valid_servings_required');
  }
  if (!Array.isArray(input?.ingredients) || input.ingredients.length === 0) {
    reasons.push('ingredient_lines_required');
  }
  if (
    input?.measured_edible_weight_g != null &&
    !validPositive(input.measured_edible_weight_g)
  ) {
    reasons.push('valid_measured_edible_weight_required');
  }

  const seen = new Set<string>();
  const totals = {
    calories_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  };
  const provenance: {
    ingredient_id: string;
    profile_key: string;
    source: unknown;
  }[] = [];

  const rows = Array.isArray(input?.ingredients) ? input.ingredients : [];
  for (const [index, line] of rows.entries()) {
    const id = cleanId(line?.ingredient_id);
    const key = cleanId(line?.profile_key);
    const state = cleanId(line?.preparation_state);
    const profile = line?.profile;

    if (!id || seen.has(id)) {
      reasons.push('missing_or_duplicate_ingredient_identity:' + index);
      continue;
    }
    seen.add(id);

    if (!key || !state) {
      reasons.push('invalid_ingredient_quantity_or_state:' + id);
      continue;
    }

    const isCount = profile?.basis_unit === 'each';
    const validMass =
      !isCount &&
      validPositive(line.quantity_g) &&
      line.quantity_each == null;
    const validCount =
      isCount &&
      validPositive(line.quantity_each) &&
      line.quantity_g == null;

    if (!validMass && !validCount) {
      reasons.push('invalid_ingredient_quantity_or_state:' + id);
      continue;
    }

    if (
      !profile ||
      profile.status !== 'validated' ||
      key !== cleanId(profile.profile_key) ||
      state !== cleanId(profile.preparation_state) ||
      !(isCount
        ? profile.basis_g == null &&
          profile.basis_quantity === 1 &&
          Boolean(cleanId(profile.serving_name))
        : validPositive(profile.basis_g) && profile.basis_unit === 'g') ||
      !validNonnegative(profile.calories_kcal) ||
      !validNonnegative(profile.protein_g) ||
      !validNonnegative(profile.carbs_g) ||
      !validNonnegative(profile.fat_g) ||
      profile.provenance === null ||
      profile.provenance === undefined ||
      (typeof profile.provenance === 'string' && !profile.provenance.trim())
    ) {
      reasons.push('validated_matching_profile_required:' + id);
      continue;
    }

    const factor = isCount
      ? line.quantity_each! / profile.basis_quantity!
      : line.quantity_g! / profile.basis_g!;
    totals.calories_kcal += profile.calories_kcal * factor;
    totals.protein_g += profile.protein_g * factor;
    totals.carbs_g += profile.carbs_g * factor;
    totals.fat_g += profile.fat_g * factor;
    provenance.push({
      ingredient_id: id,
      profile_key: key,
      source: profile.provenance,
    });
  }

  if (Object.values(totals).some(value => !Number.isFinite(value))) {
    reasons.push('finite_batch_nutrition_required');
  }

  if (reasons.length) {
    return {
      status: 'insufficient_evidence',
      recipe_id: recipeId,
      recipe_state_version: recipeVersion,
      reasons,
    };
  }

  const round3 = (value: number) => Math.round(value * 1000) / 1000;
  const perServing = (value: number) => round3(value / input.servings);
  const batchTotals: RecipeNutritionTotals = {
    calories_kcal: round3(totals.calories_kcal),
    protein_g: round3(totals.protein_g),
    carbs_g: round3(totals.carbs_g),
    fat_g: round3(totals.fat_g),
  };
  const edibleWeight = input.measured_edible_weight_g ?? null;
  const per100g: RecipeNutritionTotals | null = edibleWeight
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
    calories_kcal: perServing(totals.calories_kcal),
    protein_g: perServing(totals.protein_g),
    carbs_g: perServing(totals.carbs_g),
    fat_g: perServing(totals.fat_g),
    batch_totals: batchTotals,
    measured_edible_weight_g: edibleWeight,
    per_100g: per100g,
    ingredient_count: rows.length,
    provenance,
  };
}

export function calculateWeighedRecipePortionNutrition(
  batch: RecipeIngredientNutritionCalculation,
  portionWeightG: number,
):
  | {
      status: 'validated';
      calories_kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      portion_weight_g: number;
    }
  | { status: 'insufficient_evidence'; reasons: readonly string[] } {
  if (
    batch.status !== 'validated' ||
    !validPositive(batch.measured_edible_weight_g)
  ) {
    return {
      status: 'insufficient_evidence',
      reasons: ['measured_validated_batch_required'],
    };
  }
  if (
    !validPositive(portionWeightG) ||
    portionWeightG > batch.measured_edible_weight_g
  ) {
    return {
      status: 'insufficient_evidence',
      reasons: ['valid_measured_portion_weight_required'],
    };
  }

  const factor = portionWeightG / batch.measured_edible_weight_g;
  const scale = (value: number) => Math.round(value * factor * 1000) / 1000;
  return {
    status: 'validated',
    portion_weight_g: portionWeightG,
    calories_kcal: scale(batch.batch_totals.calories_kcal),
    protein_g: scale(batch.batch_totals.protein_g),
    carbs_g: scale(batch.batch_totals.carbs_g),
    fat_g: scale(batch.batch_totals.fat_g),
  };
}
