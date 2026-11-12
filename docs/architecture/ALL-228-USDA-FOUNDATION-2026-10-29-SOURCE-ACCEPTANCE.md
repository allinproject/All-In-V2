# ALL-228 — October 2026 USDA Foundation source acceptance (pre-import)

Status: **Official archive downloaded and inspected; candidate staging/import NOT executed.**

## Verified external source

- Publisher: USDA FoodData Central
- Dataset: Foundation Foods, JSON, October 29, 2026 release
- Source URL: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip
- ZIP bytes: **696866**
- ZIP SHA-256: **dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579**
- Archive JSON member: `FoodData_Central_foundation_food_json_2026-10-29.json`
- JSON root collection: `FoundationFoods`
- Parsed source records: **424**
- Hosted source inspection: https://github.com/allinproject/All-In-V2/actions/runs/43326464469

Validated ZIP central directory via `unzip -t`, safe/unique member paths,
a single JSON member, nonempty parseable JSON, and the actual SHA-256/size
from the downloaded official file. This is evidence for the SOURCE archive,
not approval of nutrition, ingredient mapping, readiness, or licensing beyond
the publisher's stated source.

The actual first-record schema included:
`dataType`, `description`, `fdcId`, `foodAttributes`,
`foodCategory`, `foodClass`, `foodNutrients`, `foodPortions`,
`inputFoods`, `isHistoricalReference`, `ndbNumber`,
`nutrientConversionFactors`, and `publicationDate`.

The first nutrient observation carried `amount`, `dataPoints`,
`foodNutrientDerivation`, `id`, `median`, `nutrient`, and `type`.
The source may contain multiple nutrient observations; **do not simply
select the first**. The ALL-228 generic normalization was hardened to hold
ambiguous duplicate facts as unknown until reviewed.

## Next guarded pipeline

1. Verify the archive's byte hash against this exact release manifest in
   any deterministic seed/import task. Refuse a different release or mutated bytes.
2. Parse `FoundationFoods` from this source, enumerate exact FDC identities,
   preparation-state evidence and duplicate/unknown nutrient observations.
3. Apply existing `ingredientSeedPreview.ts` candidate/unchanged/conflict
   reconciliation and report counts; no automatic promotion.
4. Map only explicitly approved stable V2 ingredient identities.
   Unknown preparation states and raw-vs-cooked profiles remain distinct.
5. Reuse the existing canonical ingredient reviewer/writer and
   `v2_ingredient_*` schema; do not create another catalog, import
   into production or mark any source record calculation-ready from
   its presence in this source archive alone.
6. Preserve full ALL-251 privacy/release gates for future user-authored food
   separately from shared public canonical ingredient facts.

No database was changed; no ZIP or provider response was committed to GitHub.
