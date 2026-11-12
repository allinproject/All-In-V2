-- ALL-218 read-only source lifecycle coverage report.
-- Do NOT use these counts as publication or nutrient-calculation eligibility.
-- Source status labels are indicators, not accepted V2 contract states.

SELECT count(DISTINCT s.recipe_id) AS recipes_with_any_selector,
       count(DISTINCT s.recipe_id) FILTER (WHERE s.active) AS recipes_with_active_selector,
       count(DISTINCT s.recipe_id) FILTER (
         WHERE s.active AND s.verification_status IN ('reviewed','fully_calculated')
       ) AS recipes_with_review_like_active_selector
FROM public.allin_recipe_selectors s;

SELECT count(*) FILTER (WHERE s.active AND o.active) AS active_selector_option_pairs,
       count(*) FILTER (
         WHERE s.active AND o.active AND
               o.verification_status IN ('reviewed','verified_default','verified_recipe_specific')
       ) AS active_pairs_with_review_like_option,
       count(*) FILTER (
         WHERE s.active AND o.active AND
               s.verification_status IN ('reviewed','fully_calculated') AND
               o.verification_status IN ('reviewed','verified_default','verified_recipe_specific')
       ) AS review_like_active_pairs,
       count(*) FILTER (WHERE NOT s.active AND o.active) AS individually_active_options_under_inactive_selector
FROM public.allin_recipe_selectors s
JOIN public.allin_recipe_selector_options o ON o.selector_id=s.id;

SELECT count(*) FILTER (WHERE verified) AS verified_component_mappings,
       count(DISTINCT recipe_id) FILTER (WHERE verified) AS recipes_with_any_verified_component_mapping,
       count(*) FILTER (WHERE NOT verified AND quantity_g IS NOT NULL) AS unverified_components_with_quantities
FROM public.allin_recipe_component_mappings;

-- Source candidate review, not promotion to readiness. Listing the pair does
-- not guarantee exact ingredient, method or cooking-yield evidence.
SELECT s.recipe_id,s.id AS source_selector_id,s.selector_key,s.verification_status AS selector_review_state,
       o.id AS source_option_id,o.option_key,o.verification_status AS option_review_state
FROM public.allin_recipe_selectors s
JOIN public.allin_recipe_selector_options o ON o.selector_id=s.id
WHERE s.active AND o.active
  AND s.verification_status IN ('reviewed','fully_calculated')
  AND o.verification_status IN ('reviewed','verified_default','verified_recipe_specific')
ORDER BY s.recipe_id,s.selector_key,o.option_key;
