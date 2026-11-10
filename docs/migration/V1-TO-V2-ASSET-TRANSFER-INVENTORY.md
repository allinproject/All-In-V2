# ALL IN 365 — V1 to V2 Product Asset Transfer Inventory

**Owner:** ALL IN 365 — V2 Rebuild  
**Canonical V2 source:** `allinproject/All-In-V2`, branch `integration/v2-foundation`  
**Canonical V2 backend:** Supabase project `xarhuczrtzuiljmtdaeu` (All-In-V2, us-west-2)  
**V1 reference:** `allinproject/ALL-IN`, Supabase project `impulecgsgaruvniuttc` (All in)  
**Status:** Inventory started; no bulk transfer or V2 schema migration performed.

## Founder decision

The founder is the only person who has signed into V1. There is no V1 customer base to migrate. Create a fresh founder account in V2 once the V2 signup/legal flow is ready. The V2 Supabase project becomes the new canonical backend from the beginning of V2; V1 is the source/reference for selected product assets and proven behavior.

Do not build a broad customer-account migration, dual-auth scheme, or split V1/V2 source of truth. Do not migrate personal founder workout/Food Log/profile data by default; that is a separate opt-in decision.

V1 does contain one profile and a single Coach thread with 16 message rows (8 user, 8 assistant, one owner). Treat that as founder/test history—not required product continuity—and exclude it from the V2 migration unless the founder later requests it.

## Transfer inventory

| Asset | V1 source / evidence | V2 action | Acceptance / caution |
|---|---|---|---|
| Coach behavior and runtime | V1 Supabase Edge Function `allin-coach`, **ACTIVE version 18**, `verify_jwt=true`, deployed source SHA-256 `da56531e252d924a0915b1168f923f51985a004fd6d4c91bb1a8e341f90fefe3`; source is retrievable through Supabase. V1 repo has `supabase/functions/allin-coach-staged-v13` plus extensive tests, but staged V13 is **not** the deployed v18 source. | Port the exact deployed v18 source and required helper modules as the behavioral baseline; adapt backend/database calls to V2 schema. Preserve safety boundaries, model routing/cost controls, privacy, deterministic bypasses, structured actions, typed context and fail-closed behavior. | Capture source manifest/hash; map every RPC/table/storage/secret/env dependency; focused tests on V2 schema; authenticated Coach regression fixtures; no deploy before acceptance. |
| Cookbook / Recipe catalog | V1 `public.allin_recipes`: 1,019 rows. Related product datasets: `allin_recipe_selectors` 1,293 rows; `allin_recipe_selector_options` 5,876; `allin_ingredient_profiles` 408; `allin_recipe_component_mappings` 2,855. V1 also has recipe browse, import, adaptive selection, nutrition, yields, ratings and copy-on-write contracts in Native source and SQL. | Import approved product-owned catalog and associated selector/ingredient/component data into V2 as versioned seed/import artifacts. Port recipe rules and reviewed calculation logic. | Preserve recipe IDs/links, ingredient references, nutrition/yield provenance, publication status, variants and ordering. Exclude founder-owned favorites, ratings, My Versions and personal recipes unless separately requested. Validate counts, referential integrity, representative recipe nutrition and browse/search before acceptance. |
| Legal package | Linear document “ALL IN 365 — Founder Beta Legal Package (Working Draft)” and current V1 legal acceptance code/contracts. | Transfer working legal text and version/acceptance requirements; review and finalize for the V2 product/company/website before enabling signup. Implement V2-owned acceptance through V2 schema/writers. | The source is a **working draft**, not automatically final legal advice or final published terms. Preserve LLC/company/contact/version details but verify dates, product features, privacy disclosures, pricing, cancellation, AI and health disclaimers, deletion/export and vendor disclosures before launch. |
| Business / product plan | Linear document “ALL IN 365 — Durable Product & Launch Authority from Chat Migration (2026-10-31)” plus later founder decisions and project issue authority. | Transfer business model, pricing, trial/referral rules, launch sequence, metrics, positioning and product decisions into a V2-owned authority document. | Reconcile with the latest founder decisions; newest explicit decision/current Linear issue wins over older consolidation docs. |
| Brand identity | Linear document “ALL IN 365 — Brand, Naming, Merch & Public Identity Authority (Chat Migration 2026-10-31)”; V1 source includes theme/color components. | Transfer brand language, mark, app icon, black/white/muted-gold palette, typography and voice. Build V2 design tokens and components from the approved source. | Preserve “ALL IN 365”, “Live All In.” and “Your whole fitness life in one place.” Do not abbreviate to AI365. Confirm exact logo/asset files before recreating. |
| Website | Founder identified an existing website and domain `allin365.app`. Connected Wix currently returns no site for the linked account; broad Drive searches did not locate a definitive website source. | Locate canonical hosting/editor/repository, source copy, media, forms, analytics, legal links, domains and deployment settings; transfer or rebuild in V2's designated web owner. | Do not invent a replacement site or change DNS/deployments. Site source/owner is currently an external discovery gap. |
| App designs / UX | V1 Native route/component implementation and decisions; Figma account is connected but canonical file key(s) have not yet been identified. | Locate canonical Figma files, page list, screen flows, variables, components, typography and design references; port design system and screen specifications to V2. | Do not infer Figma file identity. Visual transfer should preserve the approved brand and screen behaviors, not merely copy screenshots. |
| Personal founder data | V1 reports one profile, one training row and one food-entry row; Coach message table has one owner / one thread / 16 rows. | Exclude from product asset seed. Recreate the founder account in V2 and optionally re-enter only the personal preferences/data the founder chooses. | No personal row-level export/import by default. No password hash migration. |

## V1 infrastructure observations

- V1 migrations include a large accumulated history (roughly 958 applied at repository baseline); do not replay them wholesale into V2.
- V1 has a substantial product-owned schema for recipes, selection components, Coach, training, nutrition, recovery, community, privacy and billing. V2 needs an intentional clean schema baseline with only approved feature scope.
- V1 live Coach is version 18, JWT-protected. The V1 source repo's staged V13 candidate is not an exact substitute for the live v18 bundle.
- Supabase table inspection also surfaced a critical advisory: `allin_private.race_verifier_state` had RLS disabled. This is a V1 security finding to review separately; do not copy that configuration into V2.
- V2 Supabase was ACTIVE_HEALTHY and empty at initial inspection: 0 migrations, 0 tables in `public`/`allin_private`, 0 Edge Functions.

## Recommended transfer order

1. Freeze the V2 architectural boundary and create a V2-owned source/asset manifest.
2. Port and validate brand/design tokens and app-shell patterns; find the canonical Figma file.
3. Create the V2 clean schema/auth/legal foundation and fresh founder signup.
4. Port exact Coach v18 behavior together with its reviewed context, RPC and table dependencies.
5. Import cookbook catalog and related product datasets as a reproducible seed; validate counts/references/nutrition.
6. Transfer the legal package after review; align it with implemented V2 practices.
7. Locate and transfer the actual website source and business/launch materials.
8. Validate end-to-end journeys in the V2 environment. Only V2 becomes canonical for the new product; V1 remains an archived reference until no longer needed.

## Not done yet

- No production or V2 database DDL applied.
- No V1 rows copied to V2.
- No Coach function deployed to V2.
- No Figma file or website ownership confirmed.
- No legal draft declared final.
- No existing V1 account or personal data migrated.


## Cookbook source-quality profile (read-only V1 inspection)

V1 `allin_recipes` contains 1,019 rows, but visibility and readiness are not equivalent:

- 20 rows: `status=draft`, `published=false`.
- 886 rows: `status=draft`, `published=true`.
- 1 row: `status=tested`, `published=true`.

Do not infer that every row with `published=true` is cookbook-ready. Preserve both status fields and all provenance; resolve the meaning of the `draft + published` combination against current V1 app behavior and Cookbook readiness rules before setting V2 catalog visibility.

Recipe selector/option state is also mixed:

- Selectors: 187 awaiting_alternative_formula and inactive; 3 false_positive and inactive; 3 interactive_unverified_macros and inactive; 181 no_alternative_method_documented and inactive; 13 not_generic_swap and inactive; 310 fully_calculated and active; 1 default_only_estimated and active; 563 interactive_unverified_macros and active; 29 needs_review and active; 3 reviewed and active.
- Selector options: 12 blocked_pending_calculation inactive; 960 documented_method inactive; 270 documented_method active; 5 estimated active; 1 existing_default_estimated active; 452 form_preserving_generic active; 374 needs_formula inactive; 1 needs_label_mapping inactive; 176 needs_label_mapping active; 1,615 needs_review active; 648 not_universally_compatible inactive; 113 retired_duplicate inactive; 102 retired_redundant inactive; 4 reviewed active; 1 verified_default inactive; 1,110 verified_default active; 32 verified_recipe_specific active.
- Component mappings: 27 verified, 2,828 unverified.

The seed/import must preserve these lifecycle and verification fields. The V2 UI/calculation pipeline must not treat `active=true` or `published=true` alone as proof of nutrition or cooking-method validation. The product's cookbook-ready threshold and source-of-truth status semantics must be reviewed before public V2 visibility.

## Security reference finding

V1 Supabase table inspection surfaced a critical advisory: `allin_private.race_verifier_state` has RLS disabled. This is a V1 issue to review separately. V2 must never reproduce that security posture; all V2 private tables require RLS and tested grants/policies before use. No V1 policy was changed during this inspection.


## Newly located authoritative Library assets — 2026-11-10

### App Art / visual design — v2 is the authority

The V1 Library contains `ALL-IN-App-Art-Design-Handoff-v2.md` (dated 2026-10-26; visual review complete) and `ALL-IN-App-Art-CURRENT.md` (dated 2026-10-28). Their contents are transferred verbatim into:
- `docs/product/ALL-IN-365-APP-ART-DESIGN-HANDOFF-v2.md`
- `docs/product/ALL-IN-365-APP-ART-CURRENT-AUTHORITY.md`

Handoff v2 explicitly states that approved screens are closed: do not repeatedly regenerate/review/reopen unless the founder requests a change or implementation encounters a real conflict. It locks bottom navigation Today / Fuel / Train / Community / Coach; Profile from the top-right avatar; black/charcoal/warm-white/muted-gold palette; no green or rainbow sport colors; persistent Coach pattern; Coach creates/adjusts plans while Train displays/executes; Recipes, Cook Now/Meal Prep, Pantry/Shopping, Strength, Completed Activity, Profile, Community and import flows. The full 30 KB handoff is preserved as the design reference; do not replace it with a summary or screenshots.

Figma file IDs still have not been identified. The design handoff is the canonical approved design/interaction specification now available to implementation; the underlying editable Figma file/library remains a separate discovery item, not a blocker to applying the approved spec.

### Business / financial source

The V1 Library contains `Durben_Ventures_First_Year_Revenue_Projection.docx`, prepared 2026-11-03 for a D-U-N-S business information request. It is transferred as `docs/business/FIRST-YEAR-REVENUE-PROJECTION-2026-11-03.md`.

It forecasts $8,991 first-year gross subscription sales from 900 paid subscriber-months at $9.99/month after a seven-day trial, assuming the first two months have no paid subscribers and month 12 reaches 200 paid subscriber equivalents. It excludes expenses, taxes, payment fees, refunds, marketing, merchandise and annual plans. This is a historical unvalidated planning estimate, not actual revenue, net income, a guarantee or a comprehensive business plan.

### Older referral / subscription source

The October 22, 2026 Library handoff is preserved as `docs/business/REFERRAL-SUBSCRIPTION-HANDOFF-2026-10-22-HISTORICAL.md`. It records a historical $5/month price and $50/year option. The $5 monthly price is superseded by the later $9.99/month founder decision; do not carry the old price into V2. Referral safety principles and milestones are retained for reconciliation with the latest product decisions.

A V2-owned brand/product operating authority was created at `docs/product/ALL-IN-365-BRAND-AND-PRODUCT-OPERATING-AUTHORITY.md`. It is a working consolidation, not a substitute for issue-level requirements or final legal/business approval.

### Website status

The legal draft and D&B submission identify `https://allin365.app` as the company-supplied website. The current website's actual source/editor/hosting and asset library have not yet been located. Connected Wix returned no sites, so do not assume Wix is its owner and do not change DNS or deploy a replacement.



## Full approved design package transferred — 2026-11-10

The V2 repo now preserves these exact V1 Library sources:

1. `docs/product/ALL-IN-365-APP-ART-DESIGN-HANDOFF-v2.md` — authoritative 30 KB approved screen/interaction handoff (v2, not v1).
2. `docs/product/ALL-IN-365-APP-ART-CURRENT-AUTHORITY.md` — source pointer and closure rule.
3. `docs/product/ALL-IN-365-UI-COMPONENT-ASSET-SPEC-v1.md` — production-ready component, icon, imagery, motion, responsive, system-state, accessibility and Watch visual requirements.
4. `docs/product/ALL-IN-365-BADGE-SYSTEM-SPEC-v1.md` — badge / PR / milestone semantics and visual rules.
5. `docs/migration/reference/ALL-IN-APP-ART-VISUAL-QA-V1-CHECKPOINT.md` — historical observations of V1 implementation drift, explicitly labelled as not V2 acceptance evidence.

Use handoff v2 over v1 wherever they differ. Its APPROVED = CLOSED rule is non-negotiable: do not regenerate or re-approve screens the founder already approved. Preserve newer explicit product decisions and feature acceptance contracts if they supersede a handoff detail. The canonical primary nav is Today / Fuel / Train / Community / Coach; Profile is reached from the avatar/header. The token file `apps/mobile-v2/src/theme/tokens.ts` now carries the approved base palette, spacing, radius and navigation constants. The V2 shell sign-in/home/index/onboarding screens have been moved onto the exact approved color values.

Editable Figma file key(s) remain undiscovered. The design transfer is nevertheless sufficient to begin implementing the approved screens and global components without reopening design approval. Continue locating the editable Figma file/library for source-layer access and future asset handoff only.

## Business plan completeness

V2 has transferred the approved brand/product operating summary and the dated first-year revenue estimate, plus the historical referral pricing handoff with a clear supersession note. This is **not** yet a complete business plan. The existing source set does not yet include a complete current operating model covering market/competition, acquisition, budget, operating costs, runway, unit economics, support/operations, and sensitivity scenarios. Build that plan from verified founder-approved inputs; do not infer missing costs or forecasts from the $8,991 gross sales estimate.


## Founder Cookbook correction — ingredient-first nutrition — 2026-11-10

The latest V1 app is the intended Cookbook UX/behavior baseline. V2 cookbook recipe records do not need their own calorie, protein, carbohydrate or fat totals. **Do not migrate the V1 recipe nutrition JSON, old macro-delta selector fields or recipe-level macro snapshots into V2.** Store recipe ingredients, measured amounts/units, preparation state, instructions, servings/yield, structured ingredient/selector choices and source provenance. The V2 nutrition calculator derives per-serving/batch/portion output from the current ingredient state; changing ingredients, quantities, servings or selectors triggers a fresh calculation.

Port the latest V1 calculator source, not the legacy recipe macro-delta SQL path:
- `Native/src/lib/recipeAdaptationNutritionEvidence.ts` — pure validated ingredient arithmetic, batch/per-serving/per-100g/weighed portion calculations and provenance.
- `Native/src/data/recipeNutritionOnOpen.ts` — on-open calculation, exact profile/alias resolution, quantity/state parsing, partial/missing disclosure and bounded USDA estimates.
- `Native/src/data/cookbookIngredientUsdaCoverage.ts` — exact USDA source proof and profile readiness.
- `Native/src/data/cookbookCookingYieldAdmission.ts`, `Native/src/data/cookingYieldIntelligence.ts`, and associated tests — exact cooking-yield evidence and fail-closed unresolved state.

V1 currently has an ACTIVE v7 JWT-protected `search-food-products` function (deployed SHA-256 `6ffc6825214f20bb484078b47c35b79f43f6fcfce5447c9f7473ac1fc6267346`) that searches USDA FoodData Central generic food candidates and Open Food Facts/Search-a-licious branded products. Its barcode lookup path separately checks exact USDA Branded GTIN matches and then Open Food Facts product API v3. V2 must own new server-side adapters and V2 cache/schema; no runtime dependence on V1 or copied secret.

Provider choices: USDA FDC is the primary generic ingredient reference; Open Food Facts is the packaged/branded product and barcode source, retaining community-unverified quality and ODbL obligations. Do not add paid Edamam initially: the deterministic calculator plus USDA/OFF matches the reviewed V1 design. Reconsider only after a measured source-coverage gap.

See [V2 Cookbook Ingredient-first Nutrition Calculator](../architecture/V2-COOKBOOK-INGREDIENT-FIRST-NUTRITION-CALCULATOR.md). Implementation order: ALL-225 calculator/yield port, ALL-226 provider adapters, then ALL-218 recipe catalog seed without macro fields.


## Calculator implementation source preserved — 2026-11-10

The following exact V1 source files at reference commit `b285fd7ddac879f6732d1a5bae5532cfecfd297f` have been copied into V2 under `docs/migration/reference/cookbook-calculator-v1/` as **reference-only inputs**:

- `recipeAdaptationNutritionEvidence.ts` — pure deterministic calculator kernel.
- `recipeNutritionOnOpen.ts` — latest app's ingredient-first nutrition display/estimate flow.
- `cookingYieldIntelligence.ts` — exact evidence-keyed cooking-yield conversion.
- `cookbookCookingYieldAdmission.ts` — ingest classification and manual-review/batch-required safeguards.
- `SOURCE-MANIFEST.md` — source commit and porting warnings.

These are not wired into V2 and are not deployable V2 modules. They retain V1 types and schema assumptions. The V2 implementation must adapt them into V2-owned source modules and preserve the no-recipe-macro rule.

V1 provider runtime was also confirmed:
- `search-food-products` ACTIVE v7, `verify_jwt=true`, deployed SHA-256 `6ffc6825214f20bb484078b47c35b79f43f6fcfce5447c9f7473ac1fc6267346`.
- Generic ingredient lookup: USDA FoodData Central; packaged branded search: Open Food Facts / Search-a-licious.
- Exact barcode lookup is a distinct path: USDA Branded candidate followed by Open Food Facts Product API v3.
- V2 requires its own USDA FDC API key stored as an Edge Function secret; the V1 key is not copied or exposed.


## Recipe quantity / yield / Pantry-to-Shopping founder decision — 2026-11-10

Standard Cookbook recipes must store cooked/prepared finished edible target quantities on their recipe cards. When added to the Meal Plan, planned servings scale those cooked target amounts. The planner first consumes usable exact-state cooked/prepared Pantry stock, converts only the remaining cooked target to raw/dry/as-purchased amount with exact reviewed Cooking Yield evidence, then consumes compatible raw/dry Pantry stock and adds only the final shortage to Shopping. Cooked and raw lots must never be treated as the same stock or netted in the same unit without explicit conversion. Reserved/expired/unusable stock does not count. Missing/ambiguous yield evidence remains manual review, not a guessed purchase quantity.

Freezer kits are explicitly exempt from the standard cooked-target recipe-card rule. Their raw/dry ingredients and freeze/defrost/cook lifecycle must remain intact.

Before V2 recipe catalog publication, perform a line-by-line audit of every standard recipe and report compliant, corrected, freezer-kit-exempt, yield-evidence-missing and manual-review totals. Do not silently convert uncertain quantities.

Full contract: `docs/architecture/V2-COOKBOOK-INGREDIENT-FIRST-NUTRITION-CALCULATOR.md`. Linear implementation issue: ALL-229.
