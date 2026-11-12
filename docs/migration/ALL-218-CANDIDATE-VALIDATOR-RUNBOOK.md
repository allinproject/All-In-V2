# ALL-218 — Review-only candidate validator

The staging candidate SQL lives in `docs/migration/ALL-218-REVIEW-ONLY-NO-MACRO-CANDIDATE-PROJECTION.sql`. The Node.js validator is in `scripts/validate-cookbook-candidates.cjs` with regression tests in `scripts/validate-cookbook-candidates.test.cjs`.

## Run locally

From the repository root, after an approved **read-only V1** export has produced separate newline-delimited JSON objects for the four staged projections:

```bash
node --test scripts/validate-cookbook-candidates.test.cjs
node scripts/validate-cookbook-candidates.cjs \
  recipes=/private/path/recipes.ndjson \
  selectors=/private/path/selectors.ndjson \
  options=/private/path/options.ndjson \
  mappings=/private/path/mappings.ndjson
```

Each line may be the projected object directly or a wrapper with its SQL alias (`staged_candidate_json`, `staged_selector_json`, `staged_option_json`, or `staged_mapping_json`). Empty lines are skipped. Files must contain UTF-8 JSONL, not a single JSON array. The validation process does not read credentials or contact V1/V2 APIs.

The validator fails on missing datasets, malformed records, duplicate source IDs, nested legacy macro fields (`nutrition`, `nutrition_delta`, common macro fields), missing recipe content, invalid serving counts, duplicate version IDs, invalid selector-change shape and broken recipe/selector/option/mapping references. It returns a JSON report with `ok`, counts, errors and the constant **`publicationApproved:false`**. Exit code 1 means validation failures, 2 means malformed command or processing error. No V2 table is created or written.

**Important limits:** The validator is a *candidate shape and reference check*, not product-ownership review, complete unit/preparation normalization, ingredient profile review, recipe nutrition, cooking-yield validation, image byte verification, source snapshot freeze, or approved publication. Child `active=true` never overrides inactive selector status. Unreviewed component quantities must remain unreviewed. The legacy 43 sparse embedded versions are kept unresolved; this script does not invent inherited ingredients. The local regression test suite was exercised during authoring, but a repository CI run and full exported-candidate validation have not been confirmed.

## Release gates

Do not import or publish until ALL-222 establishes final ownership/migrations/RLS, ALL-228 establishes canonical ingredient identity, ALL-225 validates deterministic nutrition and yields, ALL-226 confirms provider boundaries, ALL-229 completes cooked-target/freezer-kit review, and the V2 foundation/installed app integration is accepted. Recalculate and reconcile the digest manifest before a frozen approved seed.

Nothing in this folder should be interpreted as authorization to write to live V1 or V2.

## Source review coverage (2026-11-12)

The read-only `docs/migration/ALL-218-SOURCE-REVIEW-COVERAGE.sql` report found **3,208** active selector-option pairs, **775** whose option has a review-like source status, and **274** where both parent selector and option have review-like source statuses. These are **not** 274 approved V2 choices; no ingredient or cooking-yield acceptance is implied. Also found **457** individually active options under inactive parent selectors, which must never be selectable. Only **27** component mappings across **5** recipes have `verified=true`; **2,590** unverified component mappings still contain a quantity.

Before making a selectable option visible in V2, require ownership, source status and exact quantity/yield compatibility through the final ALL-222/225/228/229 contracts. Do not silently promote V1 `fully_calculated` or `verified_default` labels as proof that dynamic V2 nutrition is validated.

## Follow-up hardening — 2026-11-12

The validator now checks **scoped uniqueness** as well as row IDs: `(recipe,selector_key)`, `(selector,option_key)`, and `(recipe,selector_key,option_key,profile_key)`. It rejects an *active* selector with no real matching default option while preserving inactive false-positive records as source history. Composite keys use tuple serialization rather than concatenating fields with a delimiter. Malformed/null JSONL records fail as validation errors without crashing relationship checking.

These changes are covered by five additional committed regressions (14 total in the repository test file). Equivalent local Node tests for the original nine cases, scoped key scenarios and malformed/null inputs passed; the current GitHub revision has **not** been independently executed in CI. Do not claim full V1 candidate acceptance until an actual four-dataset export is validated and reconciled to the recorded source manifest.

## Export drift guard — additional slice

The review-only validator now has **explicit allowlists for every top-level field** in all four SQL candidate projections. An unexpected field—even one using an unfamiliar name for a macro or source metadata—is a validation error and requires review of both the SQL projection and the downstream contract. Nested legacy `nutrition` and `nutrition_delta` keys remain forbidden recursively. Two additional negative tests cover unexpected recipe and selector fields (16 total committed tests).

This staging projection is an audit format, **not** the final canonical V2 schema. Field-list changes should never be auto-accepted: first update source provenance documentation, review the change against the no-authored-macros rule, then adjust the allowlist and tests. Equivalent local Node checks exercised the added rejection path; CI on the exact committed code remains unconfirmed.

## Full snapshot verification and freezer-kit review — 2026-11-12

The validator accepts optional `counts=/path/to/expected-counts.json`. The project-pinned review-only count baseline is `docs/migration/ALL-218-REVIEW-CANDIDATE-EXPECTED-COUNTS-2026-11-12.json` (907 recipes, 1,293 selectors, 5,876 options, 2,855 component mappings). Example:

```bash
node scripts/validate-cookbook-candidates.cjs \
  recipes=/private/path/recipes.ndjson \
  selectors=/private/path/selectors.ndjson \
  options=/private/path/options.ndjson \
  mappings=/private/path/mappings.ndjson \
  counts=docs/migration/ALL-218-REVIEW-CANDIDATE-EXPECTED-COUNTS-2026-11-12.json
```

The flag rejects incomplete or extra records against that review source count, but cannot detect same-count substitutions: also compare the V1 PostgreSQL projections against the source SHA-256 manifest. A genuine approved source change requires a fresh source review and new counts/digests, never silent regeneration.

The recipe projection now explicitly preserves `source_freezer_kit_review_only` for 20 V1 freezer-kit records. The exact read-only V1 SQL projection was executed after this change: 907 recipes; 20 explicit freezer-kit source modes; zero nested `nutrition` and `nutrition_delta` keys. The three observed source `kind` values are `freezer_kit` (8), `raw_kit` (2), and `uncooked_assembled` (10). These are review candidates, not normalized V2 meal states. Their assembly, freeze, thaw and cook-day instructions and raw component measures remain separate from cooked edible recipe amounts. Source recipe projection SHA-256 is updated in the committed digest manifest; the other three unchanged projections retain their prior hashes.

The test runner now has a lightweight no-deploy workflow at `.github/workflows/v2-cookbook-candidate-validation.yml`, triggered only by its own script/test/workflow files. It does not run Expo/npm installs or require database secrets. Until the run is checked, do not claim the GitHub Actions job passed. The script is also checked with a small isolated JavaScript harness for critical expected-count, malformed-input, nested-macro and freezer-kit acceptance cases.

## Founder design approval and review-first triage — 2026-11-12

The founder approved ALL-218 **architecture and staged source review**, recorded in Linear comment `7470d4c0-676e-480d-8ced-914e81ed2896`. **This is not authorization to deploy a V2 migration, import live records, make any recipe publicly visible, or bypass ALL-222/225/226/228/229/216.**

A lightweight source review report is available in `scripts/cookbook-review-triage.cjs`, with `scripts/cookbook-review-triage.test.cjs` and the existing isolated Cookbook CI workflow. After the separately approved, read-only recipe candidate projection has been exported to newline-delimited JSON, run:

```bash
node --test scripts/cookbook-review-triage.test.cjs
node scripts/cookbook-review-triage.cjs /private/path/recipes.ndjson 907 > /private/path/recipe-review-queue.json
```

Each output recipe has the source identity, a raw freezer-kit indicator, a list of source-review flags, and the constant `reviewRequired:true`, `publicationApproved:false`. The report groups counts of missing provenance, V1 draft/unpublished source states, free-text ingredient lines, incomplete ingredient items or amounts, and sparse source variants; it requires a source review of cooking quantity and preparation state for standard recipes and separate assembly/cook-day review for freezer kits. It intentionally flags ingredient identity/calculation/yield and image rights review **for every recipe** until separately adjudicated. It does not copy nutrient facts, infer cooking yield, decide source rights, issue publication credentials, or write to a database. The review queue is a worklist, not an approved seed.

A source candidate can move from source preservation to ingredient/quantity verification and cooking/yield verification only under its owning domain contracts. Publication requires a distinct audited owner decision under a final, approved writer/security design, not any source `published`, `tested`, `active`, image `approved`, triage flag absence, or passing validator status.

## Actionable review lanes — 2026-11-12

After the architecture-only founder approval, the source triage script now assigns each source recipe to exactly one **human work-allocation lane**. The precedence is source identity/rights (missing source origin, `[Merged]` legacy-title or `recipe-import-` identity) → ingredient and variant structure (free-text or malformed ingredient lines, missing ingredient fields, incomplete variant inputs) → freezer-kit assembly/cook-day method → standard cooked/prepared ingredient quantities. The script also reports every underlying flag, which can overlap.

The read-only `docs/migration/ALL-218-SOURCE-REVIEW-LANE-COUNTS.sql` was executed against V1 (verified 907 recipes) after commit `022bd2ed692448e95dcc8edab77a22b7404ddaae`: **260 source identity/rights**, **59 ingredient/variant structure**, **20 freezer-kit method**, **568 standard measurements**. These categories are *not* pass/fail and must not be interpreted as source rights approval or macro/quantity validation. Notably, V1 has seven recipe titles explicitly marked `[Merged]` and one import-form source recipe ID; those are review signals, not automatically unlawful or duplicate recipes.

The review triage implementation is `scripts/cookbook-review-triage.cjs`, now with 11 committed regression cases in `scripts/cookbook-review-triage.test.cjs`. All 11 test callbacks passed in an isolated JavaScript harness against exact fetched GitHub blobs. GitHub Actions CI remains unconfirmed. Do not publish anything from this queue. Always run the macro-free candidate validator and count manifest before analyzing a full exported snapshot; the triage utility by itself is neither a full catalog integrity validator nor a publication decision.
