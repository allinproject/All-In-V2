-- ALL-228 — V1 identity candidates. READ ONLY; not approved canonical V2 identities.
-- This deliberately excludes legacy macro values, yield factors and entire metadata.
-- V2 canonical ID/kind/preparation state, source license and review state require
-- separate explicit reviewer decisions; do not auto-import this projection.
SELECT jsonb_build_object(
  'source_profile_key',p.profile_key,
  'source_label',p.label,
  'source_category',p.category,
  'source_aliases_review_only',CASE WHEN jsonb_typeof(p.metadata->'aliases')='array'
       THEN p.metadata->'aliases' ELSE '[]'::jsonb END,
  'source_review_status_review_only',p.metadata->>'review_status',
  'source_form_note_review_only',p.metadata->>'form_note',
  'source_name_review_only',p.metadata->>'source',
  'source_url_review_only',p.metadata->>'source_url',
  'source_id_review_only',p.metadata->>'source_id',
  'source_data_type_review_only',p.metadata->>'source_data_type',
  'source_updated_at',p.updated_at,
  'identity_kind',NULL,
  'preparation_state',NULL,
  'canonical_v2_id',NULL
) AS ingredient_identity_candidate_json
FROM public.allin_ingredient_profiles p
ORDER BY p.profile_key;

-- Intentionally NULL identity_kind/preparation_state/id; a source label/alias
-- cannot choose generic vs branded or a cooking state authoritatively.
-- This export is only source review input; the standalone identity preflight
-- accepts explicitly adjudicated reviewer candidate objects, not this raw projection.
