# ALL-218 — V1 Cookbook source-readiness checkpoint (2026-11-12)

**Scope:** read-only inspection of V1 `impulecgsgaruvniuttc` and V2 `xarhuczrtzuiljmtdaeu`; not an approved recipe migration or publish decision.

## Current V1 source population

| Dataset/quality signal | Observed |
|---|---:|
| Product recipe rows | 907 |
| Distinct recipe IDs | 907 |
| Recipe selectors | 1,293 |
| Selector options | 5,876 |
| Ingredient profiles | 408 |
| Component mappings | 2,855 |
| Verified component mappings | 27 |
| Components with unverified, non-null quantity | 2,590 |
| Selector option ingredient changes nonempty | 3,719 |
| Option ingredient_changes arrays | 5,861 |
| Option ingredient_changes objects | 15 |
| Options with an object-style replace_all ingredient set | 15 |
| Recipe ingredients total | 9,247 |
| Object ingredient lines | 6,635 |
| Free-text ingredient lines | 2,612 |
| Object lines without explicit unit key | 6,532 |
| Object lines without explicit prep key | 6,617 |
| Recipes containing any free-text ingredient | 216 |
| Recipes containing object lines without unit key | 674 |
| Recipes containing object lines without prep key | 691 |
| Recipes with embedded recipe_versions_v2 metadata | 899 |
| Recipes whose embedded versions include legacy nutrition | 899 |
| Recipes with preparation_modes metadata | 875 |
| Recipes with image metadata | 893 |
| Recipes with metadata.recipe_origin missing | 256 |
| Recipes with card_completion=production_ready | 536 |
| Recipes with status=tested | 1 |

Recipe statuses: 20 `draft/unpublished`, 886 `draft/published`, 1 `tested/published`. No empty ingredient arrays, blank IDs/titles or invalid recipe serving counts were found. Instructions arrays exist on 907/907 recipes. Foreign-key-style source joins found zero orphaned selector→recipe, option→selector, component→recipe, or component→ingredient-profile rows. These structural findings **do not establish product readiness**.

### Historical mismatch requiring source reconciliation

The earlier V1-to-V2 inventory reports **1,019** recipes, but the queried live V1 source has **907** (112 fewer). Its reported state breakdown, 20 + 886 + 1, actually totals 907, not 1,019. Therefore the earlier inventory is **internally inconsistent**; this is not evidence that 112 recipes were deleted. Do not infer deletion, recreate missing rows, or promote 1,019 to an import target without an independently verified historic row set.

A lightweight deterministic inventory fingerprint using sorted `id|updated_at` is `fa499ad035d0b79eba7083fa93cdb782` for the 907-row source. This is *not* a full-content digest, only a source-change detector. Current V1 updates range from 2026-10-20 through 2026-11-09. Before export, take a fresh immutable versioned snapshot and record a full payload hash for all approved product rows.

### High-risk source-format cases

1. Some recipe ingredients are string lines rather than structured food identity and exact amount/unit/state. **Preserve authored text and mark manual review**; never guess missing grams, preparation state or yield.
2. Object lines typically store a prose `amount` (e.g., `10–11 oz raw (target 8 oz cooked)`). The missing separate `unit` and `prep` keys do not necessarily mean no quantity was written, but do mean the source is not a structured calculator-ready contract.
3. The approved V2 card needs **finished edible cooked/prepared target amounts** for standard recipes. Example: V1 `recipe-001` Chicken Philly uses raw chicken/dry rice *plus cooked targets* in its lines. The transform must separate these, retain raw purchase references as provenance, and only accept conversions backed by reviewed cooking-yield evidence. Do not automatically classify any recipe as a freezer kit just because its text mentions a freezer.
4. **All 899** recipes with `metadata.recipe_versions_v2` carry nested `nutrition` on at least one version. Blind-copying V1 `metadata` would violate the no-authored-recipe-macro rule even if the top-level recipe `nutrition` column were omitted. Use an explicit allowlist/typed projection for metadata and each nested variant; never wholesale-copy the source JSON.
5. All 2,855 component mappings contain a legacy `nutrition` JSON value; these are **not** ingredient source evidence. Only 27 mappings are verified. The 2,590 unverified mappings with quantities must not be promoted merely because quantity exists.
6. Selector `ingredient_changes` may be a list or a `replace_all` object; both require typed validation. Empty change is not necessarily invalid (default/method selector). Never import `nutrition_delta`. Treat inactive, retired, estimated, needs_review and documented_method as distinct lifecycle states.
7. V1 reports `card_completion=production_ready` for 536 rows, yet only one recipe has `status=tested`. Presentation readiness and recipe nutrition/cooking readiness are distinct. Publishability needs a reviewed V2 policy.
8. Source provenance is not uniform (`metadata.recipe_origin` absent on 256 rows). Unattributed content is not automatically confirmed product-owned or licensed for a public seed. Keep ambiguous records out of public release until source review.

### Safe next implementation boundaries

- Preserve stable source recipe and selector IDs and a source→V2 mapping; include review and source-version evidence.
- Stage only **product-owned** catalog content, with provenance and publication/validation state preserved independently. Do not transfer personal favorites, ratings, My Versions, or user-authored history.
- Build a **schema-specific explicit field projection** only after ALL-222/ALL-228 owning data contracts are final. Forbidden: V1 `nutrition`, nested recipe-version `nutrition`, option `nutrition_delta`, component `nutrition`, recipe macro-panel substitutes.
- Require line-by-line cooked-target and freezer-kit exception classification under ALL-229; missing exact state/yield remains manual review.
- Use reviewed local V2 ingredient profiles with dynamic ALL-225 calculation and ALL-226 discovery integration. No provider calls on ordinary recipe open/recalculate where reviewed local profiles exist.
- Keep V1 and V2 read-only until final migrations, permissions/RLS and representative test coverage are accepted. Never deploy an unapproved generic catalog table or seed.

## Repeatable evidence

- `docs/migration/ALL-218-V1-COOKBOOK-SOURCE-AUDIT.sql`
- `docs/migration/ALL-218-INGREDIENT-STATE-AND-SELECTOR-READINESS-AUDIT.sql`
- Linear ALL-218 source issue and architecture contracts ALL-222/225/226/228/229.

**Status:** source audit and import hazard classification progressed; no snapshot export or production seed has been executed. V2 has no recipe catalog table as of this inspection.
