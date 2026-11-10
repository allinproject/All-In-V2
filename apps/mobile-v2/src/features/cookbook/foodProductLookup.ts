import type { SupabaseClient } from '@supabase/supabase-js';

export type BrandedFoodNutritionCandidate = {
  barcode: string;
  source: 'usda_fdc' | 'open_food_facts';
  product_name: string;
  brand: string | null;
  portion_label: string;
  nutrition_basis: '100g' | '100ml' | 'serving' | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g?: number | null;
  saturated_fat_g?: number | null;
  sodium_mg?: number | null;
  potassium_mg?: number | null;
  calcium_mg?: number | null;
  iron_mg?: number | null;
  image_url: string | null;
  source_quality: 'reference_unverified' | 'community_unverified';
  source_license: string;
  retrieved_at: string;
  review_required: true;
};

export type OpenFoodFactsSearchCandidate = {
  barcode: string;
  product_name: string;
  brand: string | null;
  serving_size: string | null;
  image_url: string | null;
  completeness: number | null;
  unique_scans_n: number | null;
  provider: 'open_food_facts_search_a_licious';
  source_quality: 'community_unverified';
  source_license: 'Open Food Facts / ODbL; community-contributed product data';
  review_required: true;
  exact_identity_confirmed: false;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Retain leading zeroes and require the GS1 modulo-10 check digit. */
export function validateGtin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(raw)) return null;
  let sum = 0;
  let multiplier = 3;
  for (let index = raw.length - 2; index >= 0; index -= 1) {
    sum += Number(raw[index]) * multiplier;
    multiplier = multiplier === 3 ? 1 : 3;
  }
  return (10 - sum % 10) % 10 === Number(raw[raw.length - 1]) ? raw : null;
}

export function parseBrandedFoodNutritionCandidate(
  raw: unknown,
  requestedBarcode: string,
): BrandedFoodNutritionCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const source = row.source;
  const quality = row.source_quality;
  const license = row.source_license;
  const basis = row.nutrition_basis;
  const retrievedAt = clean(row.retrieved_at);
  if (
    row.status !== 'found' ||
    row.barcode !== requestedBarcode ||
    (source !== 'usda_fdc' && source !== 'open_food_facts') ||
    (quality !== 'reference_unverified' && quality !== 'community_unverified') ||
    (basis !== '100g' && basis !== '100ml' && basis !== 'serving' && basis !== null) ||
    row.review_required !== true ||
    !clean(row.product_name) ||
    !Number.isFinite(Date.parse(retrievedAt))
  ) return null;

  const expectedLicense = source === 'usda_fdc'
    ? 'USDA FoodData Central / CC0 1.0'
    : 'Open Food Facts / ODbL; community-contributed product data';
  if (license !== expectedLicense) return null;

  return {
    barcode: requestedBarcode,
    source,
    product_name: clean(row.product_name),
    brand: clean(row.brand) || null,
    portion_label: clean(row.portion_label) || 'basis unconfirmed',
    nutrition_basis: basis,
    calories: numeric(row.calories),
    protein_g: numeric(row.protein_g),
    carbs_g: numeric(row.carbs_g),
    fat_g: numeric(row.fat_g),
    fiber_g: numeric(row.fiber_g),
    saturated_fat_g: numeric(row.saturated_fat_g),
    sodium_mg: numeric(row.sodium_mg),
    potassium_mg: numeric(row.potassium_mg),
    calcium_mg: numeric(row.calcium_mg),
    iron_mg: numeric(row.iron_mg),
    image_url: clean(row.image_url) || null,
    source_quality: quality,
    source_license: expectedLicense,
    retrieved_at: retrievedAt,
    review_required: true,
  };
}

/** Search is discovery-only. A result is not exact identity until GTIN lookup. */
export async function searchV2OpenFoodFactsProducts(
  client: SupabaseClient,
  rawQuery: string,
): Promise<OpenFoodFactsSearchCandidate[]> {
  const query = String(rawQuery ?? '').replace(/\s+/g, ' ').trim();
  if (query.length < 2 || query.length > 80) throw new Error('Enter a 2–80 character product name or brand.');
  const { data, error } = await client.functions.invoke('v2-search-openfoodfacts-products', {
    body: { query },
  });
  if (error) throw error;
  if (
    !data || typeof data !== 'object' ||
    data.provider !== 'open_food_facts_search_a_licious' ||
    data.source_quality !== 'community_unverified' ||
    data.source_license !== 'Open Food Facts / ODbL; community-contributed product data' ||
    data.exact_identity_confirmed !== false ||
    data.barcode_lookup_required !== true ||
    !Array.isArray(data.results)
  ) throw new Error('Open Food Facts returned an invalid product discovery response.');

  const results: OpenFoodFactsSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of data.results.slice(0, 15)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const barcode = clean(row.barcode);
    const productName = clean(row.product_name);
    if (!validateGtin(barcode) || !productName || seen.has(barcode)) continue;
    if (
      row.provider !== 'open_food_facts_search_a_licious' ||
      row.source_quality !== 'community_unverified' ||
      row.source_license !== 'Open Food Facts / ODbL; community-contributed product data' ||
      row.review_required !== true ||
      row.exact_identity_confirmed !== false
    ) continue;
    seen.add(barcode);
    results.push({
      barcode,
      product_name: productName,
      brand: clean(row.brand) || null,
      serving_size: clean(row.serving_size) || null,
      image_url: clean(row.image_url) || null,
      completeness: numeric(row.completeness),
      unique_scans_n: numeric(row.unique_scans_n),
      provider: 'open_food_facts_search_a_licious',
      source_quality: 'community_unverified',
      source_license: 'Open Food Facts / ODbL; community-contributed product data',
      review_required: true,
      exact_identity_confirmed: false,
    });
  }
  return results;
}

/** Exact barcode lookup only. USDA Branded / OFF candidates stay unverified until reviewed. */
export async function lookupV2FoodBarcode(
  client: SupabaseClient,
  rawBarcode: string,
): Promise<BrandedFoodNutritionCandidate> {
  const barcode = validateGtin(rawBarcode);
  if (!barcode) throw new Error('Provide an exact GTIN-8, GTIN-12, GTIN-13 or GTIN-14 with a valid check digit.');
  const { data, error } = await client.functions.invoke('v2-lookup-food-barcode', {
    body: { barcode },
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || data.status !== 'found' || !data.product) {
    throw new Error('The packaged product could not be identified from this barcode.');
  }
  const candidate = parseBrandedFoodNutritionCandidate(data.product, barcode);
  if (!candidate) throw new Error('The packaged product response did not match the requested barcode or source contract.');
  return candidate;
}
