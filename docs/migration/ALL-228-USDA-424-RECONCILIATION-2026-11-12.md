# ALL-228 — USDA 424 ↔ V1 408 identity reconciliation (review only)

**Status:** Real archive and full candidate crosswalk evaluated; **ZERO canonical V2 ingredient identities, nutrition profiles, or recipe catalog records approved or imported**. This is source evidence for ALL-228 and ALL-218, not permission to deploy.

## Provenance and scope

- Exact official USDA Foundation Foods **2026-10-29** archive: ZIP SHA-256 `dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579`; validated archive/member checks and 424 unique FDC IDs.
- V1 `public.allin_ingredient_profiles`: **408** profile keys, captured read-only into `docs/evidence/ALL-228-V1-408-IDENTITY-CANDIDATE-SNAPSHOT-2026-11-12.json` with names, aliases and source links, *no nutrient values or recipe macros*.
- Full **424-row** crosswalk: `docs/evidence/ALL-228-USDA-424-V1-408-REVIEW-ONLY-CROSSWALK-2026-11-12.json`.
- Offline repeatable reconciler: `scripts/reconcile-usda-foundation-identities.py`, which checks both pinned archive and uncompressed JSON SHA-256 before reviewing names and FDC links. The actual comparison was performed with USDA ZIP bytes in a hosted environment, and its crosswalk was extended with exact FDC URL links using the saved V1 evidence. Archive ZIP itself is not committed or imported.

## Mutually exclusive USDA review categories

| Category | USDA rows | Interpretation |
|---|---:|---|
| Explicit V1 USDA FDC URL link | **8** | A V1 profile links the same FDC ID. Identity, form and source interpretation still need review. |
| Exact case/whitespace-normalized label/alias | **3** | Candidate name correspondence only, not verified nutrient/state equivalence. |
| Similar label/alias (token Jaccard >=0.42) | **110** | Human search suggestions only; may contain misleading or contradictory preparation states. |
| No candidate by these limited signals | **303** | No matching V1 name or alias identified by this audit; not evidence the food is unusable or absent from other USDA datasets. |
| **Total** | **424** | **0 approved** |

The **three exact-name review pairs** are cucumber with peel, raw (FDC **2346406** → `cucumber_raw_with_peel`); blueberries, raw (**2346411** → `blueberry_raw`); mayonnaise, regular (**2758986** → `mayonnaise_regular`).

The **eight explicit V1 food-detail source links** are:

| Source V1 profile | USDA FDC ID | Distinction requiring review |
|---|---:|---|
| `beans_kidney_canned_drained` | 2644289 | USDA describes dark-red beans with sodium and sugar added, drained/rinsed |
| `black_beans_canned_drained` | 2644285 | USDA specifically states sodium added, drained/rinsed |
| `cabbage_green_raw` | 2346407 | Compare chopped edible portion against raw USDA state |
| `chickpeas_canned_drained_rinsed` | 2644288 | USDA includes sodium added, drained/rinsed |
| `milk_cottage_2pct` | 328841 | Confirm 2% milkfat and actual form |
| `red_onion_raw` | 790577 | Confirm raw red onion edible portion |
| `tomato_paste_canned_unsalted` | 2685580 | Verify without salt added |
| `tomatoes_crushed_canned` | 2685581 | Confirm precise canned crushed form |

The eight FDC URL-linked records are **not** in addition to all 117 initial similarity suggestions; they were moved from the earlier fuzzy/no-match categories to the stronger but still unapproved **source-FDC-reference-review** category. These are 8 different V1 source profile keys. No V1 numeric legacy macros or cook-yield factors were used in matching.

## Human review sequence before mapping/seed

1. Verify explicit source identity and product/form: `fdcId`, full USDA description, V1 name, alias, raw/cooked/drained/dried/processed state, added sugar/salt, and generic-versus-branded meaning. **Do not treat an ID link as a declaration that all V1 assumptions are correct.**
2. For the three exact-name pairs, confirm that ingredient form, edible basis and identity are in fact the same. Exact text alone cannot release a profile.
3. For suggested pairs, distinguish legitimate synonyms from different ingredients, cut, state, frozen/dried/canned/roasted forms and recipe-dependent sauces. Never auto-merge based on Jaccard similarity.
4. Do not force mapping for the 303 unmatched Foundation records. Review the independent V2 ingredient identity requirements against USDA SR Legacy, FoodData Central Branded, Open Food Facts and other admissible reviewed evidence as appropriate.
5. Only after ALL-222 canonical schema/reviewer/writer approval, persist reviewed identities, aliases, per-state nutrition profiles and provenance using the owning ALL-228 release process. Preserve source/profile revisions and an audit trail. Yield conversion is separately owned by ALL-225/229.
6. Confirm exact source quantities/basis/nutrient completeness with the approved calculator, then complete ALL-218 recipe-line links and publication acceptance separately.

This document is intentionally **not** a V2 seed, review approval, migration, or license adjudication. `publicationApproved:false` and `calculationReady:false` remain unchanged.
