# V1 Cookbook calculator reference

Captured from V1 repository allinproject/ALL-IN at commit b285fd7ddac879f6732d1a5bae5532cfecfd297f (2026-11-10).

These files are **reference-only** and are not deployable V2 modules. They retain V1 types, imports, database fields and assumptions. V2 must port the algorithms/contracts into V2-owned modules and schemas.

Product rule: V2 recipe/catalog records contain ingredient, quantity, unit, preparation state, instructions, serving/yield and provenance only. Do not import recipe-level macro totals or legacy selector macro deltas. Derived per-serving nutrition is calculated from current ingredient profiles and current recipe state.

Files:
- recipeAdaptationNutritionEvidence.ts — pure calculation kernel and validated weighed-portion arithmetic.
- recipeNutritionOnOpen.ts — latest V1 on-open ingredient estimate flow, exact alias handling, quantity/state conversion, partial/missing disclosure and bounded USDA supplementation.
- cookingYieldIntelligence.ts — exact-key yield evidence, evidence precedence and raw/cooked conversions.
- cookbookCookingYieldAdmission.ts — ingest-time admission and fail-closed prepared-state handling.

V2 port also requires the V1 USDA generic search and Open Food Facts product/barcode provider contracts described in docs/architecture/V2-COOKBOOK-INGREDIENT-FIRST-NUTRITION-CALCULATOR.md. Do not copy V1 provider secrets; provision a separate V2 USDA_FDC_API_KEY Edge Function secret.
