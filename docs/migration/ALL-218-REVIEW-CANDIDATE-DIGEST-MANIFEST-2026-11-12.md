# ALL-218 — Review-only Cookbook candidate projection manifest

**Observed:** 2026-11-12 UTC (V1 read-only)  
**V1 source Supabase ref:** `impulecgsgaruvniuttc`  
**V2 target ref:** `xarhuczrtzuiljmtdaeu` — not written  
**Projection SQL:** `docs/migration/ALL-218-REVIEW-ONLY-NO-MACRO-CANDIDATE-PROJECTION.sql`  
**Status:** provisional source-change detection, **not** a frozen export artifact, legal provenance approval, migration or published recipe seed.

## Deterministic content digests

All four projections were executed read-only against V1 using the *exact SELECT statements read from the committed SQL source*, wrapped by an aggregate that does not return record contents.

| Projection | Rows | SHA-256 of ordered row SHA-256 sequence |
|---|---:|---|
| Recipes | 907 | `405f0be6fd0dc771a4471eba6d1e620dd3e805ca09df9d4dda71c2bed31fac2a` |
| Selectors | 1,293 | `598e2cbb278df0c625c7adfe6b6d3248688396ca04a201383f9c31e3d8924a0e` |
| Options | 5,876 | `0ce1891d8b67b3844999a61424b307dd6f297d4d363bb7c2fbd178fdc9b754ce` |
| Component mappings | 2,855 | `59b672f8d544b82acd3880ec63b0a7a474138934f6b3ec17b500899d1542525b` |

## Reproduction

For each projection's SELECT, remove only the terminal semicolon and wrap it:

```sql
WITH stage AS (
  -- paste one complete, committed SELECT, without its terminal semicolon
)
SELECT count(*) AS record_count,
       encode(sha256(convert_to(
         string_agg(
           encode(sha256(convert_to(staged_candidate_json::text, 'UTF8')), 'hex'),
           E'\n' ORDER BY staged_candidate_json->>'source_recipe_id'
         ),
         'UTF8'
       )), 'hex') AS candidate_projection_sha256
FROM stage;
```

Replace `staged_candidate_json` and `source_recipe_id` with the precise projected object/identity keys:
- Selectors: `staged_selector_json`, `source_selector_id`
- Options: `staged_option_json`, `source_option_id`
- Component mappings: `staged_mapping_json`, `source_mapping_id`

The ordering is **text ordering of projected source identity**, not numeric ordering. Each row uses canonical PostgreSQL `jsonb::text` serialization; byte-for-byte reproducibility requires the same field projection and compatible PostgreSQL JSONB encoding. These SHA-256 checksums are content-change indicators, not a substitute for a cryptographically signed immutable export or object-byte verification. They may change when approved source edits occur. Recalculate before the eventual selected source freeze.

## Admission blockers

These are review-only candidates and intentionally include unnormalized authored ingredient text and unverified options/mappings. Existing status/published flags are not public eligibility. The final versioned export remains blocked on product-source ownership/rights, approved schema/permissions, explicit raw/cooked/freezer-kit treatment and calculator acceptance (ALL-222/225/226/228/229 and foundation ALL-216).

Before importing, verify counts, SHA-256 fingerprints, source identity map and zero forbidden nested macro keys again. Freeze source with an immutable approved artifact before any V2 production seed. Never replay this SQL into V2 tables.
