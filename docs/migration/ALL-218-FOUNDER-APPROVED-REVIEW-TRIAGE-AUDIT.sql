-- ALL-218 founder-approved review-first catalog import.
-- This report is READ-ONLY against V1. It is not a V2 seed or publication gate.
-- Classification counts overlap: a recipe can require several kinds of review.

SELECT count(*) AS recipe_candidates,
       count(*) FILTER (WHERE status <> 'tested') AS not_tested_in_source,
       count(*) FILTER (WHERE published IS DISTINCT FROM TRUE) AS not_published_in_source,
       count(*) FILTER (WHERE NULLIF(BTRIM(metadata->>'recipe_origin'),'') IS NULL) AS source_origin_missing,
       count(*) FILTER (WHERE metadata->'preparation_modes' ? 'freezer_kit') AS freezer_kit_lifecycle_candidates
FROM public.allin_recipes;

SELECT count(DISTINCT r.id) AS recipes_with_free_text_ingredient_lines
FROM public.allin_recipes r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.ingredients)='array' THEN r.ingredients ELSE '[]'::jsonb END
) ingredient
WHERE jsonb_typeof(ingredient.value)='string';

WITH versions AS (
 SELECT r.id, version.value
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(r.metadata->'recipe_versions_v2')='array'
        THEN r.metadata->'recipe_versions_v2' ELSE '[]'::jsonb END
 ) version
)
SELECT count(DISTINCT id) AS recipes_with_sparse_versions,
       count(*) AS sparse_version_rows
FROM versions
WHERE jsonb_typeof(value->'ingredients') IS DISTINCT FROM 'array'
 OR jsonb_array_length(CASE WHEN jsonb_typeof(value->'ingredients')='array'
                            THEN value->'ingredients' ELSE '[]'::jsonb END)=0
 OR jsonb_typeof(value->'instructions') IS DISTINCT FROM 'array'
 OR jsonb_array_length(CASE WHEN jsonb_typeof(value->'instructions')='array'
                            THEN value->'instructions' ELSE '[]'::jsonb END)=0
 OR value->>'servings' IS NULL;

-- Never promote published=true, draft, image primary_hero_approved,
-- estimated ingredient quantity, or this report's flags into V2 publication.
-- Standard cards need reviewed cooked/prepared amounts; freezer kits have
-- separate raw/dry assembly and cook-day lifecycle, reviewed independently.
