-- ALL-218 — read-only candidate catalog integrity acceptance checks.
-- V1 source only. Inspect results; no DDL/DML or V2 import.
-- Integrity is not equivalent to cooking-yield or nutrition readiness.
-- Every flag count is a category: do not silently fix a failing link.

WITH failures AS (
 SELECT 'duplicate_selector_key_per_recipe' AS check_name, count(*) AS defects
 FROM (SELECT recipe_id,selector_key FROM public.allin_recipe_selectors
       GROUP BY 1,2 HAVING count(*)>1) s
 UNION ALL
 SELECT 'duplicate_option_key_per_selector',count(*)
 FROM (SELECT selector_id,option_key FROM public.allin_recipe_selector_options
       GROUP BY 1,2 HAVING count(*)>1) o
 UNION ALL
 SELECT 'duplicate_component_key',count(*)
 FROM (SELECT recipe_id,selector_key,option_key,profile_key
       FROM public.allin_recipe_component_mappings
       GROUP BY 1,2,3,4 HAVING count(*)>1) c
 UNION ALL
 SELECT 'selector_missing_parent_recipe',count(*)
 FROM public.allin_recipe_selectors s
 LEFT JOIN public.allin_recipes r ON r.id=s.recipe_id WHERE r.id IS NULL
 UNION ALL
 SELECT 'option_missing_parent_selector',count(*)
 FROM public.allin_recipe_selector_options o
 LEFT JOIN public.allin_recipe_selectors s ON s.id=o.selector_id WHERE s.id IS NULL
 UNION ALL
 SELECT 'component_missing_parent_recipe',count(*)
 FROM public.allin_recipe_component_mappings m
 LEFT JOIN public.allin_recipes r ON r.id=m.recipe_id WHERE r.id IS NULL
 UNION ALL
 SELECT 'component_missing_source_profile',count(*)
 FROM public.allin_recipe_component_mappings m
 LEFT JOIN public.allin_ingredient_profiles p ON p.profile_key=m.profile_key WHERE p.profile_key IS NULL
 UNION ALL
 SELECT 'active_selector_missing_default_option',count(*)
 FROM public.allin_recipe_selectors s WHERE s.active IS TRUE AND
 NOT EXISTS (SELECT 1 FROM public.allin_recipe_selector_options o
             WHERE o.selector_id=s.id AND o.option_key=s.default_option_key)
 UNION ALL
 SELECT 'any_selector_missing_default_option',count(*)
 FROM public.allin_recipe_selectors s WHERE
 NOT EXISTS (SELECT 1 FROM public.allin_recipe_selector_options o
             WHERE o.selector_id=s.id AND o.option_key=s.default_option_key)
 UNION ALL
 SELECT 'component_missing_selector_key',count(*)
 FROM public.allin_recipe_component_mappings m
 WHERE NOT EXISTS (SELECT 1 FROM public.allin_recipe_selectors s
                   WHERE s.recipe_id=m.recipe_id AND s.selector_key=m.selector_key)
 UNION ALL
 SELECT 'component_missing_option_key',count(*)
 FROM public.allin_recipe_component_mappings m
 WHERE NOT EXISTS (
   SELECT 1 FROM public.allin_recipe_selectors s
   JOIN public.allin_recipe_selector_options o ON o.selector_id=s.id
   WHERE s.recipe_id=m.recipe_id AND s.selector_key=m.selector_key
     AND o.option_key=m.option_key)
 UNION ALL
 SELECT 'active_options_under_inactive_selectors',count(*)
 FROM public.allin_recipe_selector_options o
 JOIN public.allin_recipe_selectors s ON s.id=o.selector_id
 WHERE o.active IS TRUE AND s.active IS FALSE
 UNION ALL
 SELECT 'variant_missing_id',count(*)
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(r.metadata->'recipe_versions_v2')='array'
        THEN r.metadata->'recipe_versions_v2' ELSE '[]'::jsonb END) v
 WHERE v.value->>'id' IS NULL
 UNION ALL
 SELECT 'duplicate_variant_id_per_recipe',count(*)
 FROM (SELECT r.id,v.value->>'id' AS variant_id
       FROM public.allin_recipes r
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(r.metadata->'recipe_versions_v2')='array'
              THEN r.metadata->'recipe_versions_v2' ELSE '[]'::jsonb END) v
       GROUP BY r.id,v.value->>'id' HAVING count(*)>1) repeated
)
SELECT check_name,defects,
       CASE WHEN check_name IN ('any_selector_missing_default_option', 'active_options_under_inactive_selectors')
            THEN 'review_inactive_or_false_positive'
            WHEN defects=0 THEN 'pass' ELSE 'block_until_review' END AS verdict
FROM failures ORDER BY check_name;

-- Review three known inactive false-positive selector candidates rather than
-- inventing their missing defaults; flag any future active occurrence.
SELECT s.id,s.recipe_id,s.selector_key,s.default_option_key,
       s.active,s.verification_status
FROM public.allin_recipe_selectors s
WHERE NOT EXISTS (
 SELECT 1 FROM public.allin_recipe_selector_options o
 WHERE o.selector_id=s.id AND o.option_key=s.default_option_key)
ORDER BY s.id;
