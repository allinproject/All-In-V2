-- ALL-218: exact precedence source-review lanes (read-only V1 source).
-- These lanes are REVIEW WORK QUEUES, not release readiness or publish status.
-- Source rights/identity > ingredient/variant structure > raw freezer-kit lifecycle
-- > standard cooked/prepared measurement review.
WITH source_flags AS (
 SELECT r.id,r.title,
   (NULLIF(BTRIM(r.metadata->>'recipe_origin'),'') IS NULL
      OR r.title ~* '^\[Merged\]'
      OR r.id LIKE 'recipe-import-%') AS source_identity,
   (
     EXISTS(
       SELECT 1 FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(r.ingredients)='array' THEN r.ingredients ELSE '[]'::jsonb END
       ) line WHERE jsonb_typeof(line.value)='string'
     )
     OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(r.ingredients)='array' THEN r.ingredients ELSE '[]'::jsonb END
       ) line WHERE jsonb_typeof(line.value)='object'
         AND (NULLIF(BTRIM(line.value->>'item'),'') IS NULL
           OR NULLIF(BTRIM(line.value->>'amount'),'') IS NULL)
     )
     OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(r.metadata->'recipe_versions_v2')='array'
              THEN r.metadata->'recipe_versions_v2' ELSE '[]'::jsonb END
       ) version WHERE jsonb_typeof(version.value->'ingredients') IS DISTINCT FROM 'array'
           OR jsonb_array_length(
             CASE WHEN jsonb_typeof(version.value->'ingredients')='array'
                  THEN version.value->'ingredients' ELSE '[]'::jsonb END)=0
           OR jsonb_typeof(version.value->'instructions') IS DISTINCT FROM 'array'
           OR jsonb_array_length(
             CASE WHEN jsonb_typeof(version.value->'instructions')='array'
                  THEN version.value->'instructions' ELSE '[]'::jsonb END)=0
           OR version.value->>'servings' IS NULL
     )
   ) AS structure,
   COALESCE(r.metadata->'preparation_modes' ? 'freezer_kit',false) AS freezer_kit
 FROM public.allin_recipes r
), classified AS (
 SELECT id,title,
   CASE WHEN source_identity THEN 'source_identity_and_rights'
        WHEN structure THEN 'ingredient_and_variant_structure'
        WHEN freezer_kit THEN 'freezer_kit_method'
        ELSE 'standard_recipe_measurements' END AS review_lane
 FROM source_flags
)
SELECT review_lane,count(*) AS recipe_count
FROM classified GROUP BY review_lane ORDER BY review_lane;

-- Lanes are exclusive; underlying review flags OVERLAP.
-- All records still require nutrition-source/image-rights/evidence review.
-- No published=true, tested status, reviewed source label, or lane permits V2 publication.
