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

## ALL-229 explicit freezer-kit and raw/cooked evidence triage

The V1 `metadata.preparation_modes` object has `freezer_kit` on **20** recipes, `freezer` on **730**, and `fridge` on **875**. Ordinary cooked-food freezer storage is **not** a freezer kit. The 20 explicit freezer-kit mode rows are **exception candidates** requiring lifecycle review, not automatic exemptions.

Heuristic source-text scanning finds 441 line mentions of `raw`, 186 of `dry`, 364 of `cooked`, and **89 lines in 50 recipes** containing both a raw/dry and cooked term. These overlap and are wording-based; they are review queues, **not** audited yield relationships, verified quantities or proof of compliance. The new SQL audit includes a sorted explicit freezer-kit evidence queue and this triage summary.

## Projection acceptance check — executed against current V1

The committed `ALL-218-REVIEW-ONLY-NO-MACRO-CANDIDATE-PROJECTION.sql` contains four independent `SELECT` projections using explicit `jsonb_build_object` fields (no `SELECT *` or whole-metadata copy). Each SELECT was retrieved from the committed file and executed read-only in a count/nested-key validation wrapper on V1:

| Candidate records | Count | Nested `nutrition` keys | Nested `nutrition_delta` keys |
|---|---:|---:|---:|
| Recipe candidates (including stripped variant content) | 907 | 0 | 0 |
| Selector candidates | 1,293 | 0 | 0 |
| Option candidates | 5,876 | 0 | 0 |
| Component candidates | 2,855 | 0 | 0 |

The projection retains **source IDs and source review states** but labels unnormalized ingredient and selector values review-only. This proves the projection does not carry the two forbidden legacy macro JSON key types across the observed V1 rows; it does not establish correct nutrition arithmetic, complete legal provenance, cooked-state compliance or V2 public readiness. The candidate SQL remains read-only and has not been used to write V2.

## Recipe hero transfer / source asset review

The V1 source has **893** recipes with an `image` metadata object, **875** with a `public_url`, **830** with a `source_type`, but only **443** with an explicit `hosted_path` and **137** with a `hosted_sha256`. **881** metadata objects claim `primary_hero_approved=true`; this assertion is not evidence that the referenced object exists in V2 Storage, has acceptable rights, or matches the dish.

The reviewed candidate projection now preserves an explicit **source-only** hero reference (`hosted_bucket`, `hosted_path`, `hosted_sha256`, `public_url`, `source_type`, approval marker and provenance), plus separate legacy visual QA markers. It does not assign a V2 Storage object/path or rehost content. Exact SQL re-execution on 907 candidate rows passed: **0** nested `nutrition` keys, **0** `nutrition_delta` keys, **443** source paths and **536** original `card_completion=production_ready` markers.

Before showing recipe imagery in V2, verify source object rights, object bytes/checksum when available, V2 upload destination and card-to-image association. A source `public_url` should remain a reference, not a new V2-owned canonical asset path.

## Embedded version inheritance / incomplete authoring review

All **3,273** V1 embedded recipe versions carry a legacy `nutrition` field. **43 versions across 12 recipes** lack their own `ingredients`, `instructions` and `servings` fields; all 43 also lack a version `status` field. They may be inherited/default choices or incomplete source records. The candidate projection deliberately preserves the absence of those fields. The V2 import must first establish source inheritance semantics and resolved variant identity; it must not substitute missing ingredient lists with invented food quantities or previously authored macro panels.

The repeatable ingredient/state audit now counts these incomplete version candidates. No variant has been normalized or published from this source audit.

## Relationship/selection preflight — 2026-11-12

The repeatable source-only preflight is in `docs/migration/ALL-218-RELATIONSHIP-AND-VARIANT-PREFLIGHT.sql`. It was executed directly against read-only V1 after commit `da9977506a8e76c0c7630eb00428255bd40deb9f`.

- **12 structural checks passed with zero defects:** no duplicate selector keys within recipe, duplicate option keys within selector, duplicate component keys, missing parent recipe/selector/profile links, missing component selector-key/option-key links, active selector with missing default option, missing embedded variant IDs, or duplicated embedded variant IDs within recipe.
- **3 inactive selectors have a missing default option**: source selector IDs `381`, `390`, `431` (recipe IDs `recipe-038`, `recipe-097`, `recipe-244`, `wrapper/bread`). All are marked inactive/`false_positive`. Preserve this source state; do not fabricate an option or make these public.
- **457 individually active options belong to inactive selectors.** Their child `active=true` must never override parent selector `active=false`. Source review statuses still control eligibility even when both flags are active.

These are not evidence that all options are validated. Recommended client eligibility requires the owning recipe to be approved, selector active and accepted, option active and accepted, exact ingredient change compatible with selected recipe variant, and recalculation from reviewed local ingredient evidence. The four source state fields must remain available for audit even where the UI excludes the choice.
