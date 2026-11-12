-- ALL-218 staged export projection, NOT a deployed schema or publishable seed.
-- Run read-only on V1. Results require source/licence, state, yield and owner review.
-- Purpose: deterministic candidate source JSON with legacy macro facts excluded.
-- NEVER run this on V2 as an INSERT; the approved V2 schema/writers own import.
-- Each SELECT returns source records for controlled export, not public-ready rows.

-- Recipe content candidates; keep raw authoring separate from normalized V2 lines.
-- Nested recipe_versions_v2 are explicitly rebuilt from allowed content keys:
-- NEVER copy metadata or the original version JSON wholesale.
SELECT jsonb_build_object(
 'source_recipe_id',r.id,
 'title',r.title,
 'category',r.category,
 'description',r.description,
 'source_status',r.status,
 'source_published',r.published,
 'servings',r.servings,
 'authored_ingredients_review_only',r.ingredients,
 'instructions',r.instructions,
 'notes',r.notes,
 'source_origin',r.metadata->>'recipe_origin',
 'source_card_completion',r.metadata->>'card_completion',
 'source_final_qa_status',r.metadata->>'final_qa_status',
 'source_hero_reference_review_only',jsonb_build_object(
   'hosted_bucket',r.metadata->'image'->>'hosted_bucket',
   'hosted_path',r.metadata->'image'->>'hosted_path',
   'hosted_sha256',r.metadata->'image'->>'hosted_sha256',
   'public_url',r.metadata->'image'->>'public_url',
   'source_type',r.metadata->'image'->>'source_type',
   'primary_hero_approved',r.metadata->'image'->'primary_hero_approved',
   'source_provenance',r.metadata->'image'->>'provenance'
 ),
 'source_updated_at',r.updated_at,
 'source_variants_review_only',
 coalesce((
   SELECT jsonb_agg(jsonb_build_object(
     'id',v.value->'id', 'label',v.value->'label',
     'source_status',v.value->'status', 'changes',v.value->'changes',
     'servings',v.value->'servings',
     'authored_ingredients_review_only',v.value->'ingredients',
     'instructions',v.value->'instructions',
     'prep_minutes',v.value->'prep_minutes',
     'cook_minutes',v.value->'cook_minutes',
     'method',v.value->'method'
   ) ORDER BY v.ordinality)
   FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(r.metadata->'recipe_versions_v2')='array'
          THEN r.metadata->'recipe_versions_v2'
          ELSE '[]'::jsonb END
   ) WITH ORDINALITY v(value, ordinality)
 ), '[]'::jsonb)
) AS staged_candidate_json
FROM public.allin_recipes r ORDER BY r.id;

-- Selector source identity and lifecycle. NOT inferred calculation readiness.
SELECT jsonb_build_object(
 'source_selector_id',s.id,
 'source_recipe_id',s.recipe_id,
 'selector_key',s.selector_key,
 'label',s.label,
 'selector_type',s.selector_type,
 'required',s.required,
 'default_option_key',s.default_option_key,
 'display_order',s.display_order,
 'source_active',s.active,
 'source_verification_status',s.verification_status,
 'source_updated_at',s.updated_at
) AS staged_selector_json
FROM public.allin_recipe_selectors s ORDER BY s.id;

-- Options contain ingredient/method changes but never nutrition_delta.
-- Reviewed lifecycle and source compatibility require explicit acceptance.
SELECT jsonb_build_object(
 'source_option_id',o.id,
 'source_selector_id',o.selector_id,
 'option_key',o.option_key,
 'label',o.label,
 'ingredient_changes_review_only',o.ingredient_changes,
 'method_changes_review_only',o.method_changes,
 'tags',o.tags,
 'recommended',o.recommended,
 'source_active',o.active,
 'source_verification_status',o.verification_status,
 'source_updated_at',o.updated_at
) AS staged_option_json
FROM public.allin_recipe_selector_options o ORDER BY o.id;

-- Component mapping input is not nutrition authority even when quantity exists.
SELECT jsonb_build_object(
 'source_mapping_id',m.id,
 'source_recipe_id',m.recipe_id,
 'selector_key',m.selector_key,
 'option_key',m.option_key,
 'source_profile_key',m.profile_key,
 'quantity_g_review_only',m.quantity_g,
 'quantity_basis',m.quantity_basis,
 'source_verified',m.verified,
 'source_updated_at',m.updated_at
) AS staged_mapping_json
FROM public.allin_recipe_component_mappings m ORDER BY m.id;
