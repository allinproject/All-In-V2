import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_BASE = "https://world.openfoodfacts.org/api/v3/product";
const USER_AGENT = "ALLIN365/2.0 (https://allin365.app)";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function text(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}
function num(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function exactGtin(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return null;
  let sum = 0;
  let multiplier = 3;
  for (let index = value.length - 2; index >= 0; index--, multiplier = multiplier === 3 ? 1 : 3) {
    sum += Number(value[index]) * multiplier;
  }
  return (10 - sum % 10) % 10 === Number(value[value.length - 1]) ? value : null;
}
function nutrientMap(food: any): Map<number, number> {
  const result = new Map<number, number>();
  if (!Array.isArray(food?.foodNutrients)) return result;
  for (const row of food.foodNutrients) {
    const id = Number(row?.nutrientId ?? row?.nutrient?.id);
    const value = num(row?.value ?? row?.amount);
    if (Number.isSafeInteger(id) && value !== null) result.set(id, value);
  }
  return result;
}
function normalizeUsdaBranded(barcode: string, foods: unknown) {
  if (!Array.isArray(foods)) return null;
  const exact = foods.filter((food: any) =>
    food?.dataType === "Branded" &&
    text(food?.gtinUpc) === barcode &&
    Number.isSafeInteger(food?.fdcId) &&
    text(food?.description)
  );
  if (exact.length !== 1) return null;
  const food = exact[0];
  const values = nutrientMap(food);
  const calories = values.get(1008);
  const protein = values.get(1003);
  const carbs = values.get(1005);
  const fat = values.get(1004);
  if ([calories, protein, carbs, fat].some(value => value === undefined)) return null;
  return {
    barcode, source: "usda_fdc", status: "found",
    product_name: text(food.description),
    brand: text(food.brandOwner) ?? text(food.brandName),
    portion_label: "100 g", nutrition_basis: "100g",
    calories, protein_g: protein, carbs_g: carbs, fat_g: fat,
    source_quality: "reference_unverified",
    source_license: "USDA FoodData Central / CC0 1.0",
    fdc_id: food.fdcId,
    retrieved_at: new Date().toISOString(),
    review_required: true,
  };
}
function gramsToMg(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n * 1_000_000) / 1000;
}
function normalizeOffProduct(barcode: string, product: any) {
  if (!product || text(product.code) !== barcode) return null;
  const nutrients = product.nutriments ?? {};
  const declaredServing = text(product.serving_size);
  const exactOneUnit = Boolean(declaredServing && /^1\s+(?:tortilla|wrap|slice|piece|egg|bar|bun|roll|bagel|each)(?:s)?(?=\s*(?:\(|$))/i.test(declaredServing));
  const complete = (basis: string) =>
    ["energy-kcal", "proteins", "carbohydrates", "fat"].every(key => num(nutrients[key + "_" + basis]) !== null);
  const useServing = Boolean(exactOneUnit && complete("serving"));
  const productUnit = text(product.product_quantity_unit) ?? text(product.serving_quantity_unit);
  const massOrVolumeBasis = productUnit === "g" ? "100g" : productUnit === "ml" ? "100ml" : null;
  const suffix = useServing ? "serving" : massOrVolumeBasis ?? "100g";
  const isBasisKnown = useServing || massOrVolumeBasis !== null;
  return {
    barcode,
    source: "open_food_facts",
    status: "found",
    product_name: text(product.product_name_en) ?? text(product.product_name) ?? "Barcode product",
    brand: text(product.brands),
    portion_label: useServing ? declaredServing : massOrVolumeBasis === "100g" ? "100 g" : massOrVolumeBasis === "100ml" ? "100 mL" : "Unknown package basis",
    nutrition_basis: useServing ? "serving" : massOrVolumeBasis,
    calories: isBasisKnown ? num(nutrients["energy-kcal_" + suffix]) : null,
    protein_g: isBasisKnown ? num(nutrients["proteins_" + suffix]) : null,
    carbs_g: isBasisKnown ? num(nutrients["carbohydrates_" + suffix]) : null,
    fat_g: isBasisKnown ? num(nutrients["fat_" + suffix]) : null,
    fiber_g: isBasisKnown ? num(nutrients["fiber_" + suffix]) : null,
    saturated_fat_g: isBasisKnown ? num(nutrients["saturated-fat_" + suffix]) : null,
    sodium_mg: isBasisKnown ? gramsToMg(nutrients["sodium_" + suffix]) : null,
    potassium_mg: isBasisKnown ? gramsToMg(nutrients["potassium_" + suffix]) : null,
    calcium_mg: isBasisKnown ? gramsToMg(nutrients["calcium_" + suffix]) : null,
    iron_mg: isBasisKnown ? gramsToMg(nutrients["iron_" + suffix]) : null,
    image_url: text(product.image_front_small_url) ?? text(product.image_front_url),
    usable: isBasisKnown && complete(suffix),
    source_quality: "community_unverified",
    source_license: "Open Food Facts database / ODbL; individual contents / DbCL",
    retrieved_at: new Date().toISOString(),
    review_required: true,
  };
}
async function fetchUsdaBranded(barcode: string, apiKey: string) {
  const url = new URL(FDC_BASE + "/foods/search");
  url.searchParams.set("api_key", apiKey);
  const upstream = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ query: barcode, dataType: ["Branded"], pageSize: 25, pageNumber: 1 }),
    signal: AbortSignal.timeout(8000),
  });
  if (upstream.status === 429) return { limited: true, candidate: null };
  if (!upstream.ok) return { limited: false, candidate: null };
  const json = await upstream.json().catch(() => null);
  return { limited: false, candidate: normalizeUsdaBranded(barcode, json?.foods) };
}
async function fetchOff(barcode: string) {
  const fields = [
    "code", "product_name", "product_name_en", "brands", "serving_size",
    "product_quantity_unit", "serving_quantity_unit", "image_front_small_url",
    "image_front_url", "nutriments",
  ].join(",");
  const url = OFF_BASE + "/" + encodeURIComponent(barcode) + ".json?fields=" + encodeURIComponent(fields);
  const upstream = await fetch(url, {
    headers: { "user-agent": USER_AGENT, "accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (upstream.status === 429 || upstream.status === 503) return { limited: true, candidate: null };
  if (!upstream.ok) return { limited: false, candidate: null };
  const json = await upstream.json().catch(() => null);
  if (!json?.product || Number(json?.status ?? 1) === 0) return { limited: false, candidate: null };
  return { limited: false, candidate: normalizeOffProduct(barcode, json.product) };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) return reply({ error: "request_too_large" }, 413);
  const body = await request.json().catch(() => null);
  const barcode = exactGtin(body?.barcode);
  if (!barcode) return reply({ error: "invalid_barcode", message: "Provide an exact GTIN-8, GTIN-12, GTIN-13 or GTIN-14 with a valid check digit." }, 400);

  const usdaKey = (Deno.env.get("USDA_FDC_API_KEY") ?? "").trim();
  if (usdaKey) {
    try {
      const result = await fetchUsdaBranded(barcode, usdaKey);
      if (result.limited) return reply({ error: "usda_rate_limited", retryable: true }, 429);
      if (result.candidate) return reply({ cached: false, status: "found", product: result.candidate });
    } catch {
      // Exact OFF barcode lookup remains available when USDA is unavailable.
    }
  }

  try {
    const result = await fetchOff(barcode);
    if (result.limited) return reply({ error: "open_food_facts_rate_limited", retryable: true }, 429);
    if (!result.candidate) return reply({ status: "not_found", product: null }, 404);
    return reply({ cached: false, status: "found", product: result.candidate });
  } catch {
    return reply({ error: "lookup_unavailable", retryable: true }, 503);
  }
});
