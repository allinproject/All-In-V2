-- ALL-218 / ALL-229: read-only ingredient and variant readiness audit.
-- Execute against V1 public schema. This is NOT a migration and writes no data.
-- Unknown units, state, or yields must stay manual-review, not auto-converted.
-- Population-level review flags overlap: do not add counts across flags.

WITH lines AS (
  SELECT r.id AS recipe_id, e.value AS line,
         jsonb_typeof(e.value) AS shape
  FROM public.allin_recipes r
  CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) e
)
SELECT count(*) AS total_lines,
       count(*) FILTER (WHERE shape='object') AS object_lines,
       count(*) FILTER (WHERE shape='string') AS free_text_lines,
       count(*) FILTER (WHERE shape='object' AND NOT(line ? 'unit')) AS object_lines_without_explicit_unit,
       count(*) FILTER (WHERE shape='object' AND NOT(line ? 'prep')) AS object_lines_without_explicit_prep,
       count(*) FILTER (WHERE shape='object' AND NOT(line ? 'amount') AND NOT(line ? 'qty')) AS object_lines_without_amount
FROM lines;

WITH flags AS (
 SELECT r.id,
        bool_or(jsonb_typeof(e.value)='string') AS any_free_text,
        bool_or(jsonb_typeof(e.value)='object' AND NOT(e.value ? 'unit')) AS missing_explicit_unit,
        bool_or(jsonb_typeof(e.value)='object' AND NOT(e.value ? 'prep')) AS missing_explicit_prep
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) e
 GROUP BY r.id
)
SELECT count(*) FILTER (WHERE any_free_text) AS recipes_with_free_text,
       count(*) FILTER (WHERE missing_explicit_unit) AS recipes_with_missing_unit,
       count(*) FILTER (WHERE missing_explicit_prep) AS recipes_with_missing_prep
FROM flags;

SELECT jsonb_typeof(ingredient_changes) AS change_shape,
       count(*) AS options
FROM public.allin_recipe_selector_options
GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE ingredient_changes IN ('[]'::jsonb, '{}'::jsonb)) AS empty_changes,
       count(*) FILTER (WHERE jsonb_typeof(ingredient_changes)='object' AND ingredient_changes ? 'replace_all') AS replace_all_object_changes,
       count(*) FILTER (WHERE jsonb_typeof(ingredient_changes)='array'
                        AND jsonb_array_length(ingredient_changes)>0) AS nonempty_array_changes,
       count(*) FILTER (WHERE active) AS active_options,
       count(*) FILTER (WHERE verification_status IN ('reviewed','verified_default','verified_recipe_specific')) AS reviewed_or_verified_options
FROM public.allin_recipe_selector_options;

SELECT count(*) FILTER (WHERE verified) AS verified_mappings,
       count(*) FILTER (WHERE NOT verified AND quantity_g IS NOT NULL) AS unverified_mappings_with_quantity,
       count(*) FILTER (WHERE verified AND quantity_g IS NULL) AS verified_mappings_missing_quantity
FROM public.allin_recipe_component_mappings;

-- A low-cost source inventory fingerprint of recipe IDs and update timestamps,
-- not a content hash and not evidence that a historic 1,019 recipe snapshot is wrong.
SELECT count(*) AS recipe_count,
       md5(string_agg(id || '|' || coalesce(updated_at::text,''), E'\n' ORDER BY id)) AS id_updated_at_md5
FROM public.allin_recipes;

-- Material review queue (read-only): explicit evidence is required before importing
-- normalized unit/state or promoting the recipe to calculator-ready.
WITH flags AS (
 SELECT r.id, r.title, r.category, r.status, r.published,
        bool_or(jsonb_typeof(e.value)='string') AS has_free_text,
        bool_or(jsonb_typeof(e.value)='object' AND NOT(e.value ? 'unit')) AS missing_unit,
        bool_or(jsonb_typeof(e.value)='object' AND NOT(e.value ? 'prep')) AS missing_prep
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) e
 GROUP BY r.id,r.title,r.category,r.status,r.published
)
SELECT * FROM flags
WHERE has_free_text OR missing_unit OR missing_prep
ORDER BY id;

-- A per-line review queue for audit tools. Raw authored text is preserved verbatim.
-- Do not assume an ingredient named raw/dry has an approved cooked yield.
SELECT r.id AS recipe_id, e.ordinality AS ingredient_position,
       e.value AS authored_ingredient,
       jsonb_typeof(e.value) AS shape,
       (jsonb_typeof(e.value)='string'
        OR (jsonb_typeof(e.value)='object' AND
            (NOT(e.value ? 'unit') OR NOT(e.value ? 'prep')))) AS requires_measurement_state_review
FROM public.allin_recipes r
CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) WITH ORDINALITY e(value, ordinality)
ORDER BY r.id,e.ordinality;

-- ALL-229 freezer-kit exception candidates: a freezer storage mode does
-- not make a recipe a raw/dry freezer kit. Inspect explicit mode only.
SELECT count(*) FILTER (WHERE metadata->'preparation_modes' ? 'freezer_kit') AS explicit_freezer_kit_mode_recipes,
       count(*) FILTER (WHERE metadata->'preparation_modes' ? 'freezer') AS ordinary_freezer_mode_recipes,
       count(*) FILTER (WHERE metadata->'preparation_modes' ? 'fridge') AS fridge_mode_recipes
FROM public.allin_recipes;

-- Heuristic triage ONLY: vocabulary mentions are not proof of edible-state
-- correctness, raw purchase weight or an approved cooking-yield ratio.
WITH lines AS (
 SELECT r.id, CASE WHEN jsonb_typeof(e.value)='string'
                   THEN trim(both '"' FROM e.value::text)
                   ELSE coalesce(e.value->>'item','') || ' ' ||
                        coalesce(e.value->>'amount','') || ' ' ||
                        coalesce(e.value->>'qty','') END AS authored_text
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(r.ingredients) e
)
SELECT count(*) FILTER (WHERE authored_text ~* '\mraw\M') AS raw_mentions,
       count(*) FILTER (WHERE authored_text ~* '\mdry\M') AS dry_mentions,
       count(*) FILTER (WHERE authored_text ~* '\mcooked\M') AS cooked_mentions,
       count(*) FILTER (WHERE authored_text ~* '\m(raw|dry)\M'
                          AND authored_text ~* '\mcooked\M') AS mixed_raw_cooked_lines,
       count(DISTINCT id) FILTER (WHERE authored_text ~* '\m(raw|dry)\M'
                                   AND authored_text ~* '\mcooked\M') AS mixed_raw_cooked_recipes
FROM lines;

-- Explicit freezer-kit candidates for review, never automatic exemption.
SELECT id,title,metadata->'preparation_modes'->'freezer_kit' AS source_freezer_kit_evidence
FROM public.allin_recipes
WHERE metadata->'preparation_modes' ? 'freezer_kit'
ORDER BY id;

-- Embedded version completeness: these may be inherited/default variants,
-- not necessarily corrupt data. Require explicit source semantic review.
WITH v AS (
 SELECT r.id AS recipe_id, x.value AS variant
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(r.metadata->'recipe_versions_v2')='array'
        THEN r.metadata->'recipe_versions_v2' ELSE '[]'::jsonb END
 ) x
)
SELECT count(*) AS source_variants,
       count(*) FILTER (WHERE variant->'ingredients' IS NULL) AS without_own_ingredients,
       count(*) FILTER (WHERE variant->'instructions' IS NULL) AS without_own_instructions,
       count(*) FILTER (WHERE variant->'servings' IS NULL) AS without_own_servings,
       count(DISTINCT recipe_id) FILTER (WHERE variant->'ingredients' IS NULL) AS affected_recipes
FROM v;
