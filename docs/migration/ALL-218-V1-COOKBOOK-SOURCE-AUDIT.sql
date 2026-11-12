-- ALL-218: read-only V1 Cookbook source audit.
-- Run against V1 only. This file neither copies user data nor writes to V1/V2.
-- Capture the query timestamp and source database identity with the result.
-- Never treat status=published or active=true as calculation-ready.
-- Ingredient-first catalog import must EXCLUDE all legacy recipe nutrition,
-- selector nutrition_delta, and component nutrition values.

select current_timestamp as audited_at, current_database() as source_database;

select 'recipes' as metric, count(*) as n from public.allin_recipes
union all select 'selectors',count(*) from public.allin_recipe_selectors
union all select 'options',count(*) from public.allin_recipe_selector_options
union all select 'ingredient_profiles',count(*) from public.allin_ingredient_profiles
union all select 'component_mappings',count(*) from public.allin_recipe_component_mappings
union all select 'verified_component_mappings',count(*) from public.allin_recipe_component_mappings where verified is true
union all select 'nonempty_option_ingredient_changes',count(*) from public.allin_recipe_selector_options
  where ingredient_changes is not null and ingredient_changes not in ('{}'::jsonb,'[]'::jsonb)
union all select 'invalid_recipe_servings',count(*) from public.allin_recipes where servings is null or servings <= 0;

select status, published, count(*) as recipes
from public.allin_recipes group by status,published order by status,published;

select verification_status, active, count(*) as selectors
from public.allin_recipe_selectors group by verification_status,active
order by verification_status,active;

select verification_status, active, count(*) as options
from public.allin_recipe_selector_options group by verification_status,active
order by verification_status,active;

select
 (select count(*) from public.allin_recipe_selectors s left join public.allin_recipes r on r.id=s.recipe_id where r.id is null) as missing_selector_recipe,
 (select count(*) from public.allin_recipe_selector_options o left join public.allin_recipe_selectors s on s.id=o.selector_id where s.id is null) as missing_option_selector,
 (select count(*) from public.allin_recipe_component_mappings m left join public.allin_recipes r on r.id=m.recipe_id where r.id is null) as missing_component_recipe,
 (select count(*) from public.allin_recipe_component_mappings m left join public.allin_ingredient_profiles p on p.profile_key=m.profile_key where p.profile_key is null) as missing_component_profile;

-- Source-shape triage: no need to copy the recipe content to report these.
select jsonb_typeof(ingredients) as ingredient_shape,
       jsonb_typeof(instructions) as instruction_shape,
       count(*) as recipe_count
from public.allin_recipes
group by 1,2 order by 1,2;

-- Identify the V1 source delta against prior inventory before choosing seed scope.
-- Historical baseline: 1019 recipes; live audit 2026-11-12: 907.
-- Do not generate the canonical seed until a source snapshot, reviewed
-- publication states, preparation states, and unresolved-yield policy
-- are approved. The actual 112-row difference is not explained by counts alone.
