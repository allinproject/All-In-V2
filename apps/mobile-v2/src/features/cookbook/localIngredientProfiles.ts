/**
 * ALL-228: pure, read-only adapter for proposed canonical Ingredient Database records.
 * No database access, USDA/OFF calls, provider cache, mutation, fuzzy search or
 * inferred density/yield. The owning catalog reader supplies reviewed local rows.
 * This is not a deployed schema, writer or authorization boundary.
 */
import {
  calculateRecipeIngredientNutrition,
  type RecipeIngredientNutritionLine,
  type RecipeIngredientNutritionCalculation,
} from './recipeNutritionCalculator.ts';

export type IngredientIdentityRow = {
  id: string;
  status: 'active' | 'retired' | 'merged';
};
export type IngredientAliasRow = {
  ingredient_id: string;
  normalized_alias: string;
  locale: string;
  preparation_state: string | null;
  status: 'active' | 'retired' | 'superseded';
};
export type IngredientProfileRow = {
  id: string;
  ingredient_id: string;
  preparation_state: string;
  basis_unit: 'g' | 'ml' | 'each';
  basis_quantity: number;
  basis_label: string;
  profile_revision: number;
  review_status: 'candidate' | 'needs_review' | 'reviewed' | 'calculation_ready' | 'retired' | 'superseded';
  is_default: boolean;
  source_record_id: string | null;
};
export type IngredientNutrientRow = {
  profile_id: string;
  nutrient_code: 'energy_kcal' | 'protein_g' | 'carbohydrate_g' | 'total_fat_g' | string;
  amount: number;
};
export type LocalIngredientCatalog = {
  ingredients: readonly IngredientIdentityRow[];
  aliases: readonly IngredientAliasRow[];
  profiles: readonly IngredientProfileRow[];
  nutrients: readonly IngredientNutrientRow[];
};
export type IngredientRequest = {
  line_id: string;
  /** Prefer exact canonical ID where available; otherwise exact unique alias. */
  ingredient_id?: string;
  label?: string;
  locale?: string;
  preparation_state: string;
  quantity_g?: number;
  quantity_each?: number;
};
export type LocalIngredientResolution = {
  status: 'ready' | 'missing' | 'ambiguous' | 'state_mismatch' | 'review_required' |
    'profile_conflict' | 'conversion_required' | 'incomplete_nutrients' | 'invalid_quantity';
  ingredient_id?: string;
  line?: RecipeIngredientNutritionLine;
};

const normalizeLabel = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const good = (value: number) => Number.isFinite(value) && value >= 0;
const positive = (value: number) => Number.isFinite(value) && value > 0;

/** Untrusted/partial rows never produce calculator-ready nutrient data. */
export function resolveLocalIngredient(
  catalog: LocalIngredientCatalog,
  request: IngredientRequest,
): LocalIngredientResolution {
  const state = typeof request?.preparation_state === 'string' ? request.preparation_state.trim() : '';
  if (typeof request?.line_id !== 'string' || !request.line_id.trim() || !state ||
      !catalog || !Array.isArray(catalog.ingredients) || !Array.isArray(catalog.aliases) ||
      !Array.isArray(catalog.profiles) || !Array.isArray(catalog.nutrients)) {
    return { status: 'missing' };
  }
  if (request.ingredient_id != null && typeof request.ingredient_id !== 'string') {
    return { status: 'missing' };
  }
  let identityId = request.ingredient_id?.trim();
  if (!identityId) {
    const label = normalizeLabel(request.label ?? '');
    const locale = typeof request.locale === 'string' ? request.locale : 'en';
    if (!label) return { status: 'missing' };
    const matching = new Set(catalog.aliases.filter(alias =>
      alias && alias.status === 'active' && alias.locale === locale &&
      normalizeLabel(alias.normalized_alias) === label &&
      (alias.preparation_state === null || alias.preparation_state === state)
    ).map(alias => alias.ingredient_id));
    if (matching.size === 0) return { status: 'missing' };
    if (matching.size > 1) return { status: 'ambiguous' };
    identityId = [...matching][0];
  }
  const identities = catalog.ingredients.filter(row => row && row.id === identityId && row.status === 'active');
  if (identities.length !== 1) return { status: 'missing' };

  const ownedProfiles = catalog.profiles.filter(p => p && p.ingredient_id === identityId);
  const stateProfiles = ownedProfiles.filter(p => p.preparation_state === state);
  if (!stateProfiles.length) return { status: 'state_mismatch', ingredient_id: identityId };

  // The physical proposal requires a reviewed single default for each state and
  // basis family. Until selection policy is approved, never guess between bases.
  const ready = stateProfiles.filter(p => p.review_status === 'calculation_ready' && p.is_default);
  if (!ready.length) return { status: 'review_required', ingredient_id: identityId };
  if (ready.length !== 1) return { status: 'profile_conflict', ingredient_id: identityId };

  const profile = ready[0];
  // Reject corrupt catalog snapshots where two records reuse one profile ID:
  // nutrient rows are joined by profile ID, so the wrong food could inherit
  // another ingredient's nutrition even if both state/default flags look valid.
  if (!profile.id?.trim() ||
      catalog.profiles.filter(row => row && row.id === profile.id).length !== 1) {
    return { status: 'profile_conflict', ingredient_id: identityId };
  }
  if (profile.basis_unit === 'ml') return { status: 'conversion_required', ingredient_id: identityId };
  const mass = profile.basis_unit === 'g' &&
    positive(profile.basis_quantity) && positive(request.quantity_g!) &&
    request.quantity_each == null;
  const count = profile.basis_unit === 'each' &&
    profile.basis_quantity === 1 && typeof profile.basis_label === 'string' &&
    Boolean(profile.basis_label.trim()) &&
    positive(request.quantity_each!) && request.quantity_g == null;
  if (!mass && !count) return { status: 'invalid_quantity', ingredient_id: identityId };
  if (!Number.isSafeInteger(profile.profile_revision) || profile.profile_revision < 1 ||
      typeof profile.id !== 'string' || !profile.id.trim() ||
      typeof profile.source_record_id !== 'string' || !profile.source_record_id.trim()) {
    return { status: 'review_required', ingredient_id: identityId };
  }

  const names = ['energy_kcal', 'protein_g', 'carbohydrate_g', 'total_fat_g'] as const;
  const found: Record<string, number> = {};
  const rows = catalog.nutrients.filter(row => row && row.profile_id === profile.id);
  for (const nutrient of names) {
    const matches = rows.filter(row => row.nutrient_code === nutrient);
    if (matches.length !== 1 || !good(matches[0].amount)) {
      return { status: 'incomplete_nutrients', ingredient_id: identityId };
    }
    found[nutrient] = matches[0].amount;
  }
  return {
    status: 'ready',
    ingredient_id: identityId,
    line: {
      ingredient_id: request.line_id,
      profile_key: profile.id,
      preparation_state: state,
      ...(mass ? { quantity_g: request.quantity_g } : { quantity_each: request.quantity_each }),
      profile: {
        profile_key: profile.id,
        preparation_state: state,
        basis_unit: profile.basis_unit,
        basis_g: mass ? profile.basis_quantity : null,
        ...(count ? { basis_quantity: 1, serving_name: profile.basis_label } : {}),
        calories_kcal: found.energy_kcal,
        protein_g: found.protein_g,
        carbs_g: found.carbohydrate_g,
        fat_g: found.total_fat_g,
        status: 'validated',
        provenance: {
          ingredient_id: identityId,
          profile_id: profile.id,
          profile_revision: profile.profile_revision,
          source_record_id: profile.source_record_id,
        },
      },
    },
  };
}

/**
 * Recipe-local computation: a missing/ambiguous row blocks validated nutrition.
 * No external provider is injected or invoked; food discovery is a separate flow.
 */
export function calculateRecipeFromLocalCatalog(input: {
  catalog: LocalIngredientCatalog;
  recipe_id: string;
  recipe_state_version: string | number;
  servings: number;
  ingredients: readonly IngredientRequest[];
  measured_edible_weight_g?: number | null;
}): RecipeIngredientNutritionCalculation {
  const resolutions = input.ingredients.map(row => resolveLocalIngredient(input.catalog, row));
  const blocked = resolutions.flatMap((result, index) =>
    result.status === 'ready' ? [] : [`local_ingredient_${result.status}:${input.ingredients[index].line_id}`]);
  if (blocked.length) {
    return {
      status: 'insufficient_evidence',
      recipe_id: input.recipe_id,
      recipe_state_version: String(input.recipe_state_version),
      reasons: blocked,
    };
  }
  return calculateRecipeIngredientNutrition({
    recipe_id: input.recipe_id,
    recipe_state_version: input.recipe_state_version,
    servings: input.servings,
    measured_edible_weight_g: input.measured_edible_weight_g,
    ingredients: resolutions.map(result => result.line!),
  });
}
