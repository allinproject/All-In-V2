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
