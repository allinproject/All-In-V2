# V2 Cookbook — Ingredient-first nutrition and calculator architecture

**Decision status:** Approved product direction, 2026-11-10  
**V2 repository:** `allinproject/All-In-V2`  
**V1 source snapshot:** `allinproject/ALL-IN`, reference commit `b285fd7ddac879f6732d1a5bae5532cfecfd297f`

## Product rule

V2 cookbook recipes are authored and stored as **recipe content**, not as pre-calculated nutrition panels.

A catalog recipe stores:
- Ingredients with explicit food identity, authored amount/unit, preparation state and optionality.
- Instructions, notes, servings/yield, preparation metadata and source/provenance.
- Reviewed selector/component options expressed as ingredient/quantity changes where applicable.
- Cooking-yield evidence/handling metadata when raw/dry purchase quantities must be reconciled with cooked/prepared target quantities.

A catalog recipe does **not** store recipe-level calories, protein, carbohydrates, fat or other macro totals as authored facts. V2 must not import old recipe `nutrition` JSON or selector `nutrition_delta` fields as the recipe's nutrition truth. Do not create replacement macro fields on catalog recipes.

Nutrition is calculated by the V2 nutrition calculator from the current ingredient list and current serving/yield context. Per-serving or per-portion output is derived display/read-model output, not an independently authored recipe record. When a user changes ingredients, quantities, serving count or variant selections, recalculate from the resulting ingredient set. Never copy a previous recipe's totals into the changed version.

This does **not** remove ingredient nutrition reference data. The ingredient nutrition profile/catalog is the calculator's input and carries its own source ID, data type, preparation state, measurement basis, nutrient values, review state, freshness and provenance.

## V1 calculator source map

The latest reviewed V1 application source at the reference commit contains:

| V1 path | Role in the V2 port |
|---|---|
| `Native/src/lib/recipeAdaptationNutritionEvidence.ts` | Pure deterministic nutrition arithmetic kernel; validated ingredient profile/basis checks, per-serving and batch totals, optional measured cooked batch mass, per-100 g result, weighed portion calculation, explicit provenance. |
| `Native/src/data/recipeNutritionOnOpen.ts` | Current recipe-open estimate pipeline: ingredient parsing, exact alias matching, explicit amount/state conversion, missing/assumed/excluded disclosure, catalog estimates and bounded USDA supplementation. |
| `Native/src/data/recipeClient.ts` | USDA generic candidate shape/normalization and the server-side function invocation contract. |
| `Native/src/data/cookbookIngredientUsdaCoverage.ts` | Cookbook ingest/save readiness check; exact reviewed USDA FDC source, unique aliases, complete calculator input, preparation and source-proof rules. |
| `Native/src/data/cookbookCookingYieldAdmission.ts` | Recipe-ingest cooking-yield metadata admission; exact source metadata only, unresolved prepared-state inputs stay manual-review/batch-required. |
| `Native/src/data/cookingYieldIntelligence.ts` and related tests | Evidence-keyed raw/dry-to-cooked conversion and measured-yield aggregation. |
| `supabase/functions/search-food-products/index.ts` | Live V1 `search-food-products` v7: USDA generic FDC candidates plus Open Food Facts / Search-a-licious branded discovery; V1 cache is backend-owned. |
| `supabase/functions/lookup-food-barcode/index.ts` + `usdaBrandedFood.ts` | Exact GTIN lookup; USDA Branded first, then Open Food Facts product v3; source quality/licence retained. |

Important separation: the pure arithmetic kernel consumes already-resolved ingredient evidence; it does not choose a food identity or invent conversions. The V2 port must retain that separation.

## Calculator contract

1. Parse a recipe line into a food identity, exact authored amount/unit, preparation state, optionality and notes. Do not silently rewrite the authored line.
2. Resolve one unique ingredient nutrition profile for the food and state. Exact label/alias match is preferred. Token reordering is allowed only when the ingredient-token set is identical and yields exactly one profile. Ambiguous aliases fail closed.
3. If no catalog profile is sufficient, request a bounded external generic-food candidate from V2's backend provider function. The user/reviewer must confirm the exact identity and raw/cooked/prepared state before it can become a reviewed profile.
4. Convert mass and supported household measures using explicit reviewed conversion records. Count units require a product/ingredient-specific item weight or a verified per-item basis. Never assume 1 piece = 1 g.
5. For raw/dry purchase amount versus cooked/prepared nutrition target, require exact cooking-yield evidence keyed by food/form/method/doneness/handling. Personal measured history must not outrank reviewed reference evidence until its defined observation threshold is met. Unsupported count/volume yield conversions remain manual review.
6. Calculate batch totals as sum(ingredient nutrient per basis × measured amount / basis); divide by the current serving count for per-serving result. If a batch's finished edible mass is actually measured, expose calculated per-100g and weighed-portion outputs. Never infer final edible mass from initial raw weight.
7. Keep missing ingredients and missing nutrients explicit. Partial estimates remain estimated/partial/unavailable; never fill a missing nutrient with zero or ask a language model to invent nutrition.
8. Persist only the appropriate ingredient-source review/profile and measured-yield evidence through their owning V2 writers. Do not persist derived recipe macro totals on catalog recipe rows.
9. Food Log / Pantry / Prepared Meal completion must use their own canonical writer and only reviewed evidence that satisfies their stronger acceptance contract. An estimate-only recipe preview cannot silently become validated food-log nutrition.
10. Every displayed estimate identifies coverage, missing ingredients, assumptions, source and preparation-state limitations. Recalculate whenever ingredients, amount, serving count, selector choice, yield or variant changes.

## Provider strategy

### Primary generic ingredient authority: USDA FoodData Central (FDC)

V2's server-side `search-food-products` equivalent will:
- Use USDA FoodData Central `/fdc/v1/foods/search` for generic ingredients and `/fdc/v1/food/{fdcId}` for detail refresh where needed.
- Prefer the appropriate Foundation Foods or SR Legacy generic records for the calculator; do not confuse generic ingredient records with branded GTIN products.
- Normalize to an explicit 100 g nutrient basis, preserve source FDC ID, data type, exact description, retrieval time, data type/review state and CC0 attribution.
- Require exact identity/preparation-state review before storing a profile as reviewed/calculation-ready.
- Keep `USDA_FDC_API_KEY` in V2 Edge Function secrets only; never return it to the app or commit it.
- Cache server-side with query normalization, bounded page size, TTL and in-flight request controls. Read and monitor USDA rate-limit headers and return a retryable rate-limit response rather than model fallback.

USDA requires a data.gov API key on each API request. Its current published default is 1,000 requests/hour/IP; exceeding the limit results in HTTP 429 and a temporary one-hour block. V2 should inspect the X-RateLimit-Limit and X-RateLimit-Remaining response headers and apply bounded server-side caching/coalescing. USDA currently lists Foundation Foods October 2026 and SR Legacy April 2018 downloads. USDA states FDC data are public domain/CC0 1.0 and requests attribution. Cite: https://fdc.nal.usda.gov/api-guide/ and https://fdc.nal.usda.gov/download-datasets/

Foundation Foods contain analytical samples of minimally processed foods; SR Legacy is historical Standard Reference data. Branded Foods are label-derived and monthly updated, not the same authority as generic Foundation data. Preserve dataType and quality distinction. Cite: https://fdc.nal.usda.gov/data-documentation/

### Packaged/branded products: Open Food Facts

Use a distinct branded-product path for exact GTIN/UPC identity:
- Exact GTIN-8/12/13/14 and valid check digit; preserve leading zeros.
- Prefer Open Food Facts current Product API v3 for product reads; do not build new work on deprecated API v2.
- Use its Search-a-licious service for full-text discovery only, not as proof of exact product identity; the OFF documentation says full-text search is not available through the current v3 product API. Exact barcode scan is preferred. Search-a-licious is a distinct service with its own API (POST search).
- Preserve community-contributed quality status and ODbL attribution. A result is a candidate, not a manufacturer-verified label.
- Never convert 100 mL values to 100 g without explicit verified density. Prefer complete exact one-item serving panel only when the serving is exactly one identified unit and all required nutrients are present.
- Retain rate-limit handling. Current OFF documentation lists 15 product reads/minute/IP and 10 search requests/minute/IP; don't call search-as-you-type.
- Use a descriptive User-Agent and follow current API terms/database licence requirements.

OFF's data are community contributed and not guaranteed accurate/complete; it is ODbL data, so V2 must preserve licence attribution and review reuse obligations. Current official documentation says v3 is recommended and v2 deprecated, with product reads limited to 15 requests/min/IP and search to 10 requests/min/IP. It requests an identifying User-Agent and encourages integrators to submit their API usage form. Cite: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/, https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/, and https://openfoodfacts.github.io/search-a-licious/users/ref-openapi/

### Do not add a paid nutrition engine by default

Edamam is not required to reproduce the V1 calculator architecture. Its full recipe analysis is a paid service and its current plan terms distinguish caching rights; don't add it merely as another source. Re-evaluate only if a measured gap remains after deterministic FDC + OFF provider flows. Cite: https://developer.edamam.com/edamam-nutrition-api

### Other services

No other external nutrition API is currently justified by the reviewed V1 behavior. Recipe URL/social import remains a separate extraction/preview workflow and must not be conflated with nutrient authority. Barcode product discovery and generic USDA ingredient search also remain separate API operations.

## V2 schema boundaries (to design in V2)

- `v2_recipe_catalog`: ingredient/instruction/source/yield/serving content only; no recipe macro columns or nutrition JSON.
- `v2_ingredient_nutrition_profiles`: food identity, preparation state, basis type/quantity/unit, nutrient profile, source provider/source ID, data type, review status, evidence and timestamps.
- `v2_ingredient_nutrition_aliases`: normalized unique alias mapping; ambiguous identity cannot be calculator-ready.
- `v2_recipe_selectors` and `v2_recipe_selector_options`: ingredient/quantity changes and compatibility/readiness evidence; no macro-delta columns.
- `v2_cooking_yield_evidence`: exact food/form/method/doneness/covered/drained matching, source, ratios/ranges, sample count and review status.
- `v2_food_provider_cache`: server-only bounded USDA/OFF cache with TTL/source/license/fetch metadata. Never expose raw provider credentials.
- `v2_recipe_nutrition_calculations` is not automatically required as a persisted table. Prefer deterministic on-demand read-model calculation; only introduce a cache when identity+recipe-state-version+serving/yield+calculator-version form an immutable cache key and invalidation is proven.

This is a proposed V2 design, not yet a deployed schema. Final table/RPC shapes require the V2 domain-ownership/security matrix.

## Acceptance tests

- Ingredient arithmetic parity against the V1 pure calculator, including gram basis, each-count basis, batch/per-serving, measured batch mass and weighed portions.
- Exact alias, exact reordered-token alias, ambiguous alias and wrong-preparation-state cases.
- Missing/partial nutrients remain missing; zero is never substituted for unknown.
- Household measure and count conversions require explicit profiles/conversion evidence.
- Raw/dry purchase vs cooked target uses exact Cooking Yield evidence only; unresolved unit/method/form fails closed.
- Changing recipe ingredient, quantity, servings or selector changes recomputes totals; no stored recipe macro snapshot is reused.
- USDA API missing key/401/429/5xx/timeout/invalid JSON, bounded cache and provenance tests.
- OFF unknown barcode, invalid GTIN, duplicate/conflicting records, partial panel, per-100mL and stale/cache/rate-limit tests.
- USDA generic data and OFF branded data cannot be confused or auto-promoted without identity review.
- Estimate-only recipe nutrition can never satisfy validated Food Log/Prepared Meal persistence requirements.
