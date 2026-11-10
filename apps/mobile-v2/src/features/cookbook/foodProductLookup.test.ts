import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupV2FoodBarcode,
  parseBrandedFoodNutritionCandidate,
  searchV2OpenFoodFactsProducts,
  validateGtin,
} from './foodProductLookup.ts';

const at = '2026-11-10T00:00:00.000Z';
const barcode = '036000291452';
const product = (overrides: Record<string, unknown> = {}) => ({
  barcode,
  source: 'open_food_facts',
  status: 'found',
  product_name: 'Test cereal',
  brand: 'Test brand',
  portion_label: '100 g',
  nutrition_basis: '100g',
  calories: 380,
  protein_g: 8,
  carbs_g: 75,
  fat_g: 5,
  image_url: null,
  source_quality: 'community_unverified',
  source_license: 'Open Food Facts / ODbL; community-contributed product data',
  retrieved_at: at,
  review_required: true,
  ...overrides,
});

test('retains exact GTIN string and rejects incorrect check digits', () => {
  assert.equal(validateGtin('036000291452'), '036000291452');
  assert.equal(validateGtin('036000291453'), null);
  assert.equal(validateGtin('36000291452'), null);
});

test('parses an exact source-tagged barcode candidate without promoting review', () => {
  const result = parseBrandedFoodNutritionCandidate(product(), barcode);
  assert.equal(result?.barcode, barcode);
  assert.equal(result?.nutrition_basis, '100g');
  assert.equal(result?.source_quality, 'community_unverified');
  assert.equal(result?.review_required, true);
  assert.equal(parseBrandedFoodNutritionCandidate(product({ barcode: '036000291453' }), barcode), null);
  assert.equal(parseBrandedFoodNutritionCandidate(product({ review_required: false }), barcode), null);
  assert.equal(parseBrandedFoodNutritionCandidate(product({ source_license: 'unknown' }), barcode), null);
  assert.equal(parseBrandedFoodNutritionCandidate(product({ source: 'usda_fdc', source_license: 'USDA FoodData Central / CC0 1.0', source_quality: 'community_unverified' }), barcode), null);
  assert.equal(parseBrandedFoodNutritionCandidate(product({ source: 'open_food_facts', source_quality: 'reference_unverified' }), barcode), null);
  assert.equal(parseBrandedFoodNutritionCandidate(product({ source: 'usda_fdc', source_license: 'USDA FoodData Central / CC0 1.0', source_quality: 'reference_unverified' }), barcode)?.source_quality, 'reference_unverified');
  assert.equal(parseBrandedFoodNutritionCandidate(product(), '036000291453'), null);
});

test('preserves 100ml and unknown bases without treating them as grams', () => {
  assert.equal(parseBrandedFoodNutritionCandidate(product({ nutrition_basis: '100ml' }), barcode)?.nutrition_basis, '100ml');
  assert.equal(parseBrandedFoodNutritionCandidate(product({ nutrition_basis: null }), barcode)?.nutrition_basis, null);
});

test('search remains discovery-only and filters invalid or duplicate barcodes', async () => {
  const client = {
    functions: { invoke: async (name: string, args: any) => {
      assert.equal(name, 'v2-search-openfoodfacts-products');
      assert.deepEqual(args.body, { query: 'oat cereal' });
      return { error: null, data: {
        provider: 'open_food_facts_search_a_licious',
        source_quality: 'community_unverified',
        source_license: 'Open Food Facts / ODbL; community-contributed product data',
        exact_identity_confirmed: false,
        barcode_lookup_required: true,
        results: [
          { barcode, product_name: 'Test cereal', brand: 'Test brand', provider: 'open_food_facts_search_a_licious', source_quality: 'community_unverified', source_license: 'Open Food Facts / ODbL; community-contributed product data', review_required: true, exact_identity_confirmed: false },
          { barcode, product_name: 'Duplicate', provider: 'open_food_facts_search_a_licious', source_quality: 'community_unverified', source_license: 'Open Food Facts / ODbL; community-contributed product data', review_required: true, exact_identity_confirmed: false },
          { barcode: '036000291453', product_name: 'Bad check digit', provider: 'open_food_facts_search_a_licious', source_quality: 'community_unverified', source_license: 'Open Food Facts / ODbL; community-contributed product data', review_required: true, exact_identity_confirmed: false },
        ],
      } };
    } },
  } as any;
  const results = await searchV2OpenFoodFactsProducts(client, ' oat   cereal ');
  assert.equal(results.length, 1);
  assert.equal(results[0].exact_identity_confirmed, false);
});

test('barcode lookup invokes V2 exact GTIN endpoint and rejects mismatched responses', async () => {
  const client = {
    functions: { invoke: async (name: string, args: any) => {
      assert.equal(name, 'v2-lookup-food-barcode');
      assert.deepEqual(args.body, { barcode });
      return { error: null, data: { status: 'found', product: product() } };
    } },
  } as any;
  const result = await lookupV2FoodBarcode(client, barcode);
  assert.equal(result.barcode, barcode);
  assert.equal(result.source, 'open_food_facts');
  await assert.rejects(lookupV2FoodBarcode(client, '036000291453'), /valid check digit/);
  client.functions.invoke = async () => ({ error: null, data: { status: 'found', product: product({ barcode: '000000000000' }) } });
  await assert.rejects(lookupV2FoodBarcode(client, barcode), /did not match/);
});
