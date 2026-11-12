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
