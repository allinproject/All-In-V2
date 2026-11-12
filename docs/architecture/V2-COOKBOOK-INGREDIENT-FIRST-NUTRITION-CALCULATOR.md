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


## Founder-approved V2 ingredient database decision — 2026-11-10

The V2 ingredient database is a first-class canonical product data system, not merely a provider cache. A user opening or recalculating a recipe must not call USDA or Open Food Facts. The calculator reads already-reviewed ingredient nutrition profiles from V2's local database and performs deterministic arithmetic on-device or in the V2 application layer using those profiles. Recipe open, re-open, serving changes and quantity edits must not trigger upstream API calls when the required reviewed profiles are present.

### Ingredient database owns reusable food facts

The V2 ingredient database should include:
- Stable V2 ingredient identity independent from a provider's ID.
- Canonical display name, food group/category, normalized preparation state and user-facing aliases.
- Search normalization and exact/unique alias resolution; ambiguous matches never auto-select.
- Nutrient profile with a declared basis (per 100 g, per 100 mL, per exact item/each or another explicitly supported basis), units and null for any unknown nutrient.
- Measurement conversions only when food-specific or unit-specific evidence is recorded; no universal one-piece weight or unverified liquid density.
- Source identity and provenance: provider/source ID, USDA data type (Foundation, SR Legacy, Branded) or OFF product ID/GTIN, source licence/attribution, fetched date, source revision when available.
- Preparation-state identity (raw, cooked, dry, drained, as-sold, prepared and other explicit states) so profiles cannot be silently interchanged.
- Review lifecycle: candidate, needs_review, reviewed, calculation_ready, retired/superseded. A raw external search result is never calculation-ready.
- Duplicate/alias merge history and deterministic V2 ID mapping.
- Optional reference micronutrients; absence remains null and must never be filled with zero.

Keep ingredient nutrient facts independent from recipe records. Recipe catalog rows store ingredient identity, amount, unit, preparation state, method, instructions, servings/yield and provenance; they do not store recipe-level macro/nutrition totals. The calculator derives batch/per-serving/per-weight output from the current recipe state and reviewed profiles.

### Import and provider strategy

1. Bootstrap common generic ingredient profiles using USDA FoodData Central downloadable bulk datasets and/or bounded initial API imports. Use Foundation Foods as primary generic analytical reference; use SR Legacy when needed. Preserve data type and source identity.
2. Normalize, deduplicate and stage records as candidates. Do not automatically promote all USDA records to reviewed profiles; food identity, data type, basis, nutrient coverage and preparation state must meet review rules.
3. Add existing Cookbook ingredient/alias mappings and exact existing profiles to V2 through a deterministic reviewed mapping; do not copy old recipe macro snapshots.
4. Use USDA API for genuinely missing food searches and controlled source refreshes—not on every recipe open.
5. Use Open Food Facts for packaged/branded products and GTIN/barcode identification. Preserve source-quality warning and ODbL/DbCL attribution. Branded product data must not be substituted for a generic ingredient without an explicit product/ingredient identity decision.
6. Cache external candidates and public provider data separately from reviewed V2 ingredient profiles. A provider cache hit is not equivalent to a reviewed ingredient record.
7. Recipe browsing/calculation works offline/provider-outage-safe once required reviewed ingredient profiles are present. Missing/unreviewed profiles yield a clear incomplete/manual-review result, never a live provider dependency or invented nutrient.

### Upstream quota protection

- No provider request on recipe open, recipe reopen, serving adjustment, ingredient-quantity edit or ordinary local recalculation.
- External ingredient search happens only when a requested food cannot be resolved from the local ingredient DB and the user explicitly enters an ingredient-search/add flow.
- Source refresh runs as queued/batched maintenance, with a global V2 budget well below upstream limits, deduplication and backoff.
- Monitor USDA `X-RateLimit-Limit` and `X-RateLimit-Remaining`; stop/defer refreshes before exhaustion and back off on 429.
- Open Food Facts exact-product and text-search budgets are separate. Search is explicit-submit only; never on each keystroke.
- Keep the USDA secret and provider access exclusively server-side.
- Add a fail-safe test that opening/recalculating a recipe with all required local profiles makes zero HTTP/provider calls.

Proposed schema ownership lives under the Cookbook domain in the V2 architecture matrix: `v2_ingredients`, `v2_ingredient_aliases`, `v2_ingredient_nutrition_profiles`, and source/review history. Final table and write-RPC shape is owned by ALL-222 before implementation.


## Founder-approved recipe quantity and Meal Plan / Pantry / Shopping contract — 2026-11-10

### Canonical recipe-card quantities

All standard Cookbook recipes must express ingredient amounts in the **finished, cooked/prepared state required on the plate**. The ingredient quantity on the recipe card is the amount the meal needs to serve the recipe's stated portions, not the raw/as-purchased amount someone must buy.

This applies to every standard recipe unless there is a deliberate product exception. **Freezer kits are excluded:** a freezer kit is a raw/dry assembly/prep workflow and keeps its own raw ingredient and freeze/defrost/cook lineage. Do not convert freezer-kit authored quantities into cooked serving targets.

Examples:
- Recipe requires 6 oz cooked chicken per serving → recipe card says 6 oz cooked chicken.
- Recipe requires 4.5 oz cooked rice → recipe card says 4.5 oz cooked rice.
- Recipe requires 5 oz cooked/drained beans → recipe card says 5 oz cooked/drained beans.
- Raw purchase weights do not belong in a standard finished-recipe ingredient line merely because the ingredient is normally purchased raw.

Every ingredient needs an explicit target preparation/weight state (cooked, cooked-and-drained, prepared, raw, dry, as-sold, etc.); no ambiguous state inference.

### Meal Plan → Shopping conversion

When a recipe is added to a meal plan:

1. Scale its cooked/prepared ingredient target to the planned servings.
2. Check usable Pantry inventory for an **exact identity + compatible preparation state + compatible unit/basis**. For a standard cooked recipe demand, prioritize cooked/prepared Pantry stock first. Reserved, expired or otherwise unusable stock is not available.
3. Deduct available cooked/prepared Pantry stock from the cooked recipe demand. If it fully covers the requirement, add no purchase line for that ingredient.
4. Convert only the remaining cooked/prepared target to the required raw/dry/as-purchased amount using exact reviewed Cooking Yield evidence keyed to the actual food/form/cut/method/doneness/lid/drained state. Do not use a generic yield factor or assume raw weight equals cooked weight.
5. Deduct any compatible raw/dry Pantry stock from that converted purchase requirement as a second coverage step. Only the remaining shortage becomes a raw/as-purchased Shopping line. Keep raw and cooked Pantry identities/quantities separate; never merge them as interchangeable stock.
6. Keep a trace of the original cooked requirement, cooked Pantry amount consumed, remaining cooked target, yield evidence/factor/range, converted raw requirement, raw Pantry amount consumed and final purchase shortage.
7. If exact yield evidence is missing/ambiguous, surface a clear manual-review/unknown quantity. Do not create a misleading raw Shopping amount and do not call USDA just to calculate the known recipe's normal view.
8. Aggregate compatible requirements across planned meals without double-counting the same Pantry stock or already-prepared meal coverage. Preserve recipe, date, serving and provenance links.
9. Apply package rounding only after netting Pantry coverage, and retain both exact required amount and package purchase amount.

This makes Pantry state material: **cooked stock is used as cooked stock before deriving raw purchases**. Example: a plan needs 24 oz cooked chicken. Pantry has 8 oz usable cooked chicken. The outstanding cooked target is 16 oz. If the exact reviewed yield is 0.75 cooked/raw, the raw requirement is 21.333 oz. Compatible raw Pantry inventory is deducted from that 21.333 oz; only the remaining shortage is added to Shopping. Do not calculate 32 oz raw first and then deduct 8 oz cooked as if the units/states were identical.

### Recipe catalog audit and conversion

Before V2 catalog publication, audit every standard recipe:
- ingredient quantity expresses cooked/prepared edible target quantity;
- preparation state and unit are explicit;
- recipe servings and per-serving quantities reconcile;
- raw/as-purchased values live only in reviewed yield/purchase metadata, not as the main standard recipe-card quantity;
- all unsupported/compound/ambiguous ingredient quantities go to manual review;
- freezer kits are explicitly tagged and excluded from this standard conversion rule.

The audit must return counts for compliant, corrected, freezer-kit-exempt, yield-evidence-missing and manual-review recipes. Do not silently rewrite or publish recipes with uncertain conversions.

### Non-negotiable acceptance journeys

- Recipe card says 6 oz cooked chicken. A meal plan for 4 servings generates a 24 oz cooked target.
- Pantry has 8 oz usable cooked chicken: the system consumes 8 oz cooked, calculates raw needs only for the remaining 16 oz cooked, deducts any compatible raw Pantry stock and adds only the final as-purchased shortage to Shopping.
- Pantry has only raw chicken: the system converts the full cooked target to raw, then deducts raw stock.
- Pantry has only cooked chicken: cooked stock satisfies target directly; no raw Shopping line appears for covered quantity.
- Pantry has both raw and cooked chicken: use cooked stock against cooked target first, then raw stock against the converted remaining target; no cross-state double counting.
- Pantry stock reserved, expired or otherwise unusable is not allocated.
- Exact yield missing or wrong method/form/drained state: no inferred purchase amount; visible unresolved/manual-review demand.
- Freezer kit retains its own raw/dry assembly and freeze/defrost/cook lifecycle and is not treated as a cooked recipe card.
- Meal Plan/Shopping recalculation is deterministic and idempotent; retry cannot double-reserve stock or duplicate purchase requirements.

## ALL-225 — versioned USDA Foundation energy and nutrient-completeness policy (2026-11-12)

This is the **staged engineering policy and regression contract**, not permission to publish or mark any catalog profile `calculation_ready`. The existing ALL-228 canonical Ingredient Database remains the owner of source profiles and reviewed nutrient values; ALL-225 owns calculation/normalization semantics. No duplicate food catalog, provider cache or recipe-level macro snapshot is introduced.

**Energy selection policy `usda-fdc-energy-specific-legacy-v1`:** For a verified USDA FDC Foundation `foodNutrients` record on exactly **100 g edible/characterized-food mass**:
1. Prefer **FDC nutrient ID 2048**, number 958, `Energy (Atwater Specific Factors)`, **kcal**, if present with valid nonnegative finite amount.
2. Otherwise accept legacy **FDC nutrient ID 1008**, number 208, `Energy`, **kcal**, if valid and present. Its method and source ID remain explicitly `legacy_energy`, not falsely labeled 2048.
3. **Never silently fall back to nutrient ID 2047**, number 957, `Energy (Atwater General Factors)`. Retain it as a distinct observed source value for source review and possible future versioned-policy choice. Do not average, add, substitute or recalculate kcal using 4/4/9 from protein/carbs/fat.
4. If neither accepted kcal source is valid, energy is **missing**, not 0; profile fails this source preflight. Reject invalid units (`kJ` instead of `kcal`), negative/non-finite amounts, duplicate FDC nutrient IDs and malformed source/basis.
5. A source update that changes methods, nutrients, basis or archive revision requires a new immutable source/profile review; never modify a published profile silently.

**Launch-core coverage `cookbook-launch-macros-v1`:** Each 100-g source candidate must have distinct, finite, nonnegative, correctly unit-typed values for **energy_kcal**, **protein_g (FDC 1003, g)**, **carbohydrate_g (FDC 1005, g; carbohydrate by difference)**, **total_fat_g (FDC 1004, g)**. A **known measured zero** is valid; a missing or null record is *unknown*, never an invented zero. Fibre, vitamins, minerals and other micronutrients remain separate *optional* facts/coverage with missing values displayed as missing; do not imply they are measured. **Sodium_mg (FDC 1093, mg)** is additionally required by this review policy for any source-qualified form where sodium/salt processing is material (e.g. all eight reviewed records in `ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json`), including products described as *without salt added* (not sodium free). This conditional requirement does not imply other foods have 0 sodium.

**Boundary:** A passing source preflight establishes only that the versioned required numerical facts were present on the stated basis. It does **not** prove source rights, generic/brand equivalence, identity/alias matching, preparation state, portion/density/yield, label completeness, required micronutrient coverage for specialized Coach guidance, authenticated reviewer approval, or product publication. The existing runtime `recipeNutritionCalculator.ts` and `localIngredientProfiles.ts` remain the sole read/calculation path; this is source-stage validation that must be met *before* ALL-228's controlled canonical writer ever marks a profile calculation-ready. A legitimate `calculation_ready` state still requires the independent ALL-228/ALL-222 approved review/writer gates.

**Implementation evidence:** `scripts/check-v2-usda-nutrient-policy.cjs` and `scripts/check-v2-usda-nutrient-policy.test.cjs` enforce the source-stage contract without network, database, API key or writes. All seven committed tests (including 8/8 previously reviewed USDA source-summary fixtures, specific vs general vs legacy energy, missing/zero and unit semantics, conditional sodium, invalid source and no self-promotion) passed in an isolated JS harness. The existing no-deploy Cookbook candidate workflow now triggers and runs the tests; GitHub Actions status for the latest revision has not yet been verified. These tests against the **committed eight-record summary evidence** are not a new full-parsing verification of every underlying nutrient in the original ZIP; that real ZIP was separately SHA/CRC verified and must remain part of later reviewer/seed acceptance.

## ALL-225 / ALL-228 — versioned source-to-canonical-review staging acceptance (2026-11-12)

A **single review-stage admission bridge**, `scripts/review-v2-usda-source-admission.cjs`, joins the existing `validateFdcNutrients()` (ALL-225 energy/core rules) with `reviewSourceBindings()` and `reviewAliasAndPreparationAcceptance()` (ALL-228 approved display/food-form policy). It consumes the eight FDC source-food fixtures on their pinned reviewed Foundation archive identity and requires exact source FDC ID + description, source archive SHA, 100 g nutrient basis, approved energy method ID and version, the source's expected protein/carbohydrate/fat/sodium values, and unchanged source-specific preparation state/alias restrictions. A mismatch fails closed. It emits a review-only proposal carrying `canonical_identity_id:null`, `profile_review_status:'needs_review'`, `authorizedToWrite:false`, `calculationReady:false`, and `publicationApproved:false` without generating any canonical ID or mutating anything. The ALL-222 secured canonical SQL writer and reviewer status-transition logic remain **unimplemented/unapproved and deliberately not called by this bridge**; this is not a new source of truth.

**Full staged path validation** in `scripts/review-v2-usda-source-admission.test.cjs` invokes the actual `apps/mobile-v2/src/features/cookbook/localIngredientProfiles.ts` read adapter and actual `recipeNutritionCalculator.ts` arithmetic, not copied or alternate nutrition code:
- All eight pinned summary fixtures pass the combined source/alias/basis policy; tampered source nutrients, energy policy ID, FDC ID, archive hash and preparation scope fail the joined review.
- A catalog with a source-backed `needs_review` profile is correctly blocked from validated ingredient/recipe totals. Ambiguous keyword-only names and wrong states do not automatically resolve.
- A **separately constructed TEST-ONLY** local catalog changes one fixture's status to `calculation_ready` purely in-memory to test the real reader/math. For **150 g** of source-form canned drained-and-rinsed sodium-added black beans (USDA **115 kcal, 6.91 g protein, 19.8 g carbohydrate, 1.27 g fat per 100 g**) split into two servings, resulting per serving is **86.25 kcal, 5.183 g protein, 14.85 g carbohydrate, 0.953 g fat**, with preserved source-record ID. The fixture cannot approve the real review stage or change a database; it intentionally simulates a future separately authorized writer outcome.
- The example values are from the previously reviewed 8-record source-summary evidence; this test does **not** represent a fresh re-extraction of all full USDA nutrient arrays or real populated Supabase/installed-device acceptance.

Native hosted Node **26.12.1** executed the actual committed TypeScript through the Node type-strip loader: **5/5 end-to-end staging tests passed**; bundled with the existing ALL-225 source policy (7) and ALL-228 identity review (19) suites, **31/31 tests passed**. The existing low-cost, no-deploy Cookbook validation workflow now includes these tests under Node 22 with `--experimental-strip-types`; GitHub Actions result for the latest commit remains to be independently checked. This source test is NOT production RLS/SQL transaction validation. ALL-222 must accept a single canonical writer, role restrictions, state transitions and audit evidence before `calculation_ready` could be set, followed by representative database staging and installed-app acceptance. No V1/V2 database writes, production migration, catalog import, publication, or Work mode occurred.

## ALL-225 ↔ ALL-228 canonical reviewer/writer handoff + isolated staging acceptance (2026-11-12)

The *existing* ALL-228 review contract now has a separate **read-only USDA review-stage admission adapter** at `scripts/review-v2-usda-source-admission.cjs`. It calls `check-v2-usda-nutrient-policy.cjs` (`usda-fdc-energy-specific-legacy-v1` and `cookbook-launch-macros-v1`) and existing `review-v2-ingredient-identities.cjs` owner functions (`reviewSourceBindings()` and `reviewAliasAndPreparationAcceptance()`) together. Inputs are the eight pinned USDA source summaries and the already founder-approved V2 display names, preparation-state and source-binding evidence.

The source handoff verifies exact USDA source ID/data type/description/ZIP SHA, source food profile key, approved form scope, energy method ID, declared 100 g basis, known core macros plus conditional sodium, and equality to the immutable reviewed source-summary values. **Review-stage admission is not a database writer or authorization grant.** Each staged record returns `canonical_identity_id:null`, `profile_review_status:'needs_review'`, `calculationReady:false` and `authorizedToWrite:false`. Any incomplete/tampered source, preparation mismatch or wrong energy method blocks the batch. The actual ALL-222-controlled canonical SQL writer must separately verify authenticated reviewer authority, transaction atomicity, version/replay, source and alias approval, profile nutrient completeness and explicit release gates before granting a future `calculation_ready` transition. No new source of truth, duplicate data store or alternate recipe calculator was introduced.

**Native runtime acceptance (isolated staging fixtures, NOT real staging PostgreSQL):** `scripts/review-v2-usda-source-admission.test.cjs` uses source-derived fixtures to exercise all eight source-review chains; directly invokes the real `apps/mobile-v2/src/features/cookbook/localIngredientProfiles.ts` and `recipeNutritionCalculator.ts` via Node's TypeScript stripping, without a test-copy arithmetic engine. The actual review-only catalog returns `insufficient_evidence` (correctly blocked). A *separate hypothetical test-only profile* simulates a future completed reviewer+writer transition to verify deterministic calculation: **150 g black beans at 115 kcal, 6.91 g protein, 19.8 g carbs, 1.27 g fat per 100 g, divided into two servings = 86.25 kcal, 5.183 g protein, 14.85 g carbs, 0.953 g fat per serving**. This does NOT mark any actual source or profile ready. Wrong IDs, mismatched energy, altered values, bad aliases and wrong preparation states are rejected.

The **7 existing policy + 19 existing identity + 5 joined integration tests = 31/31 pass** in an isolated hosted Node.js 26 test runtime, executing `node --experimental-strip-types --test` on the exact committed files. The existing lightweight no-deploy Cookbook workflow was extended to watch and run the joined tests on Node 22; its latest GitHub Actions result has not yet been independently confirmed. Detailed test provenance: `docs/evidence/ALL-225-SOURCE-TO-CALCULATOR-STAGING-ACCEPTANCE-2026-11-12.json`.

**Explicit boundary:** These are *reviewed source-summary-based staging fixtures*, not a populated authenticated staging Supabase database; they do not prove a production writer, actual source archive import, RLS grants, reviewer identity, device integration, or complete provider-origin nutrient extraction. The real canonical writer and security approval remain with ALL-222/ALL-228, and no production/staging DB mutation or publication was authorized or performed.
