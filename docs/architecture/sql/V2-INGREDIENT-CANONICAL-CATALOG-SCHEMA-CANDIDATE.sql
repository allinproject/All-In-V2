-- ALL-222 / ALL-228 canonical Ingredient Database physical SQL CANDIDATE.
-- REVIEW ONLY. NOT A VERSIONED MIGRATION. DO NOT APPLY TO SUPABASE.
-- Extends the existing canonical ERD and the separate controlled writer
-- V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql; not a second catalog.
-- Requires owner signoff on exact columns, grants and publication workflow.
CREATE SCHEMA IF NOT EXISTS allin_private;

CREATE TABLE public.v2_ingredients (
 id uuid PRIMARY KEY,
 canonical_key text NOT NULL UNIQUE CHECK(length(trim(canonical_key))>=3),
 canonical_name text NOT NULL CHECK(length(trim(canonical_name))>0),
 normalized_name text NOT NULL CHECK(length(trim(normalized_name))>0),
 identity_kind text NOT NULL CHECK(identity_kind IN ('generic_food','branded_product')),
 food_group text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired','merged')),
 merged_into_ingredient_id uuid REFERENCES public.v2_ingredients(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v2_ingredient_merge_consistency CHECK(
  (status='merged' AND merged_into_ingredient_id IS NOT NULL AND merged_into_ingredient_id<>id)
  OR (status<>'merged' AND merged_into_ingredient_id IS NULL))
);

CREATE TABLE public.v2_ingredient_aliases (
 id uuid PRIMARY KEY,
 ingredient_id uuid NOT NULL REFERENCES public.v2_ingredients(id),
 normalized_alias text NOT NULL CHECK(length(trim(normalized_alias))>0),
 locale text NOT NULL DEFAULT 'en' CHECK(length(trim(locale))>0),
 preparation_state text CHECK(preparation_state IN
   ('raw','cooked','cooked_drained','dry','as_sold','prepared')),
 alias_kind text NOT NULL CHECK(alias_kind IN
  ('canonical_synonym','common_name','source_description','reviewed_abbreviation')),
 -- Search-only strings must NOT enter the exact resolver or read adapter.
 resolution_scope text NOT NULL CHECK(resolution_scope IN ('exact','search_only','excluded')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired','superseded')),
 source_record_id uuid,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX v2_ingredient_alias_active_unique ON public.v2_ingredient_aliases
 (ingredient_id,normalized_alias,locale,coalesce(preparation_state,''))
 WHERE status='active';

CREATE TABLE public.v2_nutrient_definitions (
 code text PRIMARY KEY CHECK(length(trim(code))>0),
 display_name text NOT NULL,
 canonical_unit text NOT NULL CHECK(canonical_unit IN ('kcal','g','mg','mcg','IU')),
 launch_core boolean NOT NULL DEFAULT false,
 is_published boolean NOT NULL DEFAULT false,
 display_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.v2_ingredient_nutrition_profiles (
 id uuid PRIMARY KEY,
 ingredient_id uuid NOT NULL REFERENCES public.v2_ingredients(id),
 preparation_state text NOT NULL CHECK(preparation_state IN
  ('raw','cooked','cooked_drained','dry','as_sold','prepared')),
 basis_unit text NOT NULL CHECK(basis_unit IN ('g','ml','each')),
 basis_quantity numeric NOT NULL CHECK(basis_quantity>0),
 basis_label text NOT NULL CHECK(length(trim(basis_label))>0),
 coverage_status text NOT NULL CHECK(coverage_status IN
  ('partial','label_only','launch_core_complete','expanded_profile')),
 review_status text NOT NULL DEFAULT 'candidate' CHECK(review_status IN
  ('candidate','needs_review','reviewed','calculation_ready','retired','superseded')),
 source_quality text NOT NULL CHECK(length(trim(source_quality))>0),
 profile_revision integer NOT NULL DEFAULT 1 CHECK(profile_revision>0),
 required_nutrient_set_version text NOT NULL CHECK(length(trim(required_nutrient_set_version))>0),
 is_default boolean NOT NULL DEFAULT false,
 effective_at timestamptz,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT exact_each_basis_requires_one CHECK(basis_unit<>'each' OR basis_quantity=1)
);
CREATE UNIQUE INDEX v2_ingredient_ready_default_unique
 ON public.v2_ingredient_nutrition_profiles(ingredient_id,preparation_state,basis_unit)
 WHERE review_status='calculation_ready' AND is_default;

CREATE TABLE public.v2_ingredient_profile_nutrients (
 profile_id uuid NOT NULL REFERENCES public.v2_ingredient_nutrition_profiles(id),
 nutrient_code text NOT NULL REFERENCES public.v2_nutrient_definitions(code),
 amount numeric NOT NULL CHECK(amount>=0),
 PRIMARY KEY(profile_id,nutrient_code)
);

CREATE TABLE public.v2_ingredient_source_records (
 id uuid PRIMARY KEY,
 ingredient_id uuid REFERENCES public.v2_ingredients(id),
 provider text NOT NULL CHECK(provider IN
 ('usda_fdc','open_food_facts','manufacturer_label','reviewed_manual')),
 source_data_type text NOT NULL CHECK(length(trim(source_data_type))>0),
 external_record_id text NOT NULL CHECK(length(trim(external_record_id))>0),
 source_description text NOT NULL CHECK(length(trim(source_description))>0),
 brand_owner text,
 source_quality text NOT NULL,
 source_license text NOT NULL,
 attribution text,
 source_url text,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-fA-F0-9]{64}$'),
 mapping_status text NOT NULL DEFAULT 'candidate' CHECK(mapping_status IN
  ('candidate','mapped','rejected','superseded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,source_data_type,external_record_id)
);
ALTER TABLE public.v2_ingredient_aliases
 ADD CONSTRAINT v2_alias_source_record_fk FOREIGN KEY(source_record_id)
 REFERENCES public.v2_ingredient_source_records(id);

CREATE TABLE public.v2_ingredient_profile_sources (
 profile_id uuid NOT NULL REFERENCES public.v2_ingredient_nutrition_profiles(id),
 source_record_id uuid NOT NULL REFERENCES public.v2_ingredient_source_records(id),
 evidence_role text NOT NULL CHECK(evidence_role IN
  ('primary','corroborating','label_verification','superseded')),
 PRIMARY KEY(profile_id,source_record_id)
);
CREATE UNIQUE INDEX v2_profile_one_primary_source ON public.v2_ingredient_profile_sources(profile_id)
 WHERE evidence_role='primary';

CREATE TABLE public.v2_ingredient_measure_conversions (
 id uuid PRIMARY KEY,
 ingredient_id uuid NOT NULL REFERENCES public.v2_ingredients(id),
 profile_id uuid REFERENCES public.v2_ingredient_nutrition_profiles(id),
 preparation_state text CHECK(preparation_state IN
  ('raw','cooked','cooked_drained','dry','as_sold','prepared')),
 from_quantity numeric NOT NULL CHECK(from_quantity>0),
 from_unit text NOT NULL CHECK(length(trim(from_unit))>0),
 result_grams numeric NOT NULL CHECK(result_grams>0),
 conversion_kind text NOT NULL CHECK(conversion_kind IN
  ('food_specific_item_weight','household_density','label_serving','measured_portion')),
 source_record_id uuid REFERENCES public.v2_ingredient_source_records(id),
 review_status text NOT NULL DEFAULT 'needs_review'
  CHECK(review_status IN ('needs_review','reviewed','retired')),
 evidence_note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- No recipe-level macro records, athlete custom foods, pantry inventory,
-- yield heuristics, service secrets or duplicate provider cache are introduced.

ALTER TABLE public.v2_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredient_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredient_nutrition_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_nutrient_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredient_profile_nutrients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredient_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredient_profile_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredient_measure_conversions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
 public.v2_ingredients,public.v2_ingredient_aliases,
 public.v2_ingredient_nutrition_profiles,public.v2_nutrient_definitions,
 public.v2_ingredient_profile_nutrients,public.v2_ingredient_source_records,
 public.v2_ingredient_profile_sources,public.v2_ingredient_measure_conversions
FROM PUBLIC,anon,authenticated,service_role;
-- Athlete clients only get filtered SELECT. No direct athlete writes.
GRANT SELECT ON TABLE
 public.v2_ingredients,public.v2_ingredient_aliases,
 public.v2_ingredient_nutrition_profiles,public.v2_nutrient_definitions,
 public.v2_ingredient_profile_nutrients,public.v2_ingredient_source_records,
 public.v2_ingredient_profile_sources,public.v2_ingredient_measure_conversions
TO authenticated;

CREATE POLICY v2_ingredient_read_active
 ON public.v2_ingredients FOR SELECT TO authenticated
 USING(status='active');

CREATE POLICY v2_ingredient_alias_read_exact
 ON public.v2_ingredient_aliases FOR SELECT TO authenticated
 USING(status='active' AND resolution_scope='exact' AND
  EXISTS(SELECT 1 FROM public.v2_ingredients i
         WHERE i.id=ingredient_id AND i.status='active'));

CREATE POLICY v2_ingredient_profile_read_ready
 ON public.v2_ingredient_nutrition_profiles FOR SELECT TO authenticated
 USING(review_status='calculation_ready' AND
  EXISTS(SELECT 1 FROM public.v2_ingredients i
         WHERE i.id=ingredient_id AND i.status='active'));

CREATE POLICY v2_nutrient_definition_read_published
 ON public.v2_nutrient_definitions FOR SELECT TO authenticated USING(is_published);

CREATE POLICY v2_profile_nutrient_read_ready
 ON public.v2_ingredient_profile_nutrients FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.v2_ingredient_nutrition_profiles p
  WHERE p.id=profile_id AND p.review_status='calculation_ready'));

CREATE POLICY v2_profile_source_read_ready
 ON public.v2_ingredient_profile_sources FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.v2_ingredient_nutrition_profiles p
  WHERE p.id=profile_id AND p.review_status='calculation_ready'));

CREATE POLICY v2_source_record_read_ready
 ON public.v2_ingredient_source_records FOR SELECT TO authenticated
 USING(mapping_status='mapped' AND
  EXISTS(SELECT 1 FROM public.v2_ingredient_profile_sources ps
    JOIN public.v2_ingredient_nutrition_profiles p ON p.id=ps.profile_id
    WHERE ps.source_record_id=id AND p.review_status='calculation_ready'));

CREATE POLICY v2_conversion_read_reviewed
 ON public.v2_ingredient_measure_conversions FOR SELECT TO authenticated
 USING(review_status='reviewed' AND
  EXISTS(SELECT 1 FROM public.v2_ingredients i
         WHERE i.id=ingredient_id AND i.status='active'));

-- No permissive INSERT/UPDATE/DELETE policies. No authenticated mutation RPC.
-- Publication still blocked in the separate review-only writer candidate.
