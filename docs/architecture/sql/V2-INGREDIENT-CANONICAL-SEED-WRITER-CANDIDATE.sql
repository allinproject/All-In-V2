-- ALL-228/ALL-225: additive SEED CANDIDATE for the EXISTING canonical catalog.
-- REVIEW/ISOLATED TEST ONLY. NOT A DEPLOYABLE MIGRATION.
-- Depends on canonical catalog + existing reviewer writer, operator lifecycle,
-- and USDA source release role from existing energy-attestation SQL.
-- Never grant to authenticated, anon, service_role or public APIs.
-- Source officer independently releases verified per-100g macro/sodium facts
-- BEFORE a separate enrolled workload can insert a canonical seed.
CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_source_core_evidence (
 provider text NOT NULL CHECK(provider='usda_fdc'),
 source_data_type text NOT NULL CHECK(source_data_type='Foundation'),
 external_record_id text NOT NULL CHECK(external_record_id ~ '^[1-9][0-9]*$'),
 source_payload_sha256 text NOT NULL CHECK(source_payload_sha256 ~ '^[a-f0-9]{64}$'),
 archive_sha256 text NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 energy_kcal numeric NOT NULL CHECK(energy_kcal>=0),
 protein_g numeric NOT NULL CHECK(protein_g>=0),
 carbohydrate_g numeric NOT NULL CHECK(carbohydrate_g>=0),
 total_fat_g numeric NOT NULL CHECK(total_fat_g>=0),
 sodium_mg numeric NOT NULL CHECK(sodium_mg>=0),
 source_releaser_db_login name NOT NULL DEFAULT session_user,
 released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(provider,source_data_type,external_record_id,source_payload_sha256)
);
ALTER TABLE allin_private.v2_ingredient_source_core_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_source_core_evidence FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer,allin_v2_ingredient_source_releaser;
CREATE OR REPLACE FUNCTION allin_private.v2_prevent_source_core_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'immutable USDA source core evidence' USING ERRCODE='42501';
END $$;
CREATE TRIGGER v2_core_evidence_immutable BEFORE UPDATE OR DELETE
ON allin_private.v2_ingredient_source_core_evidence FOR EACH ROW
EXECUTE FUNCTION allin_private.v2_prevent_source_core_evidence_mutation();

CREATE OR REPLACE FUNCTION allin_private.v2_release_ingredient_source_core(
 p_fdc_id text,p_digest text,p_archive text,p_core jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 actor name:=session_user; existing allin_private.v2_ingredient_source_core_evidence%ROWTYPE;
BEGIN
 IF actor::text IN ('postgres','anon','authenticated','service_role','authenticator')
  OR NOT pg_has_role(actor::text,'allin_v2_ingredient_source_releaser','member')
  OR pg_has_role(actor::text,'allin_v2_ingredient_reviewer','member')
  OR pg_has_role(actor::text,'allin_v2_ingredient_publisher','member')
  OR NOT EXISTS (SELECT 1 FROM allin_private.v2_ingredient_review_operators o
   WHERE o.login_role=actor AND o.enabled AND o.identity_verified_at<=clock_timestamp()
    AND o.credential_expires_at>clock_timestamp() AND o.revoked_at IS NULL
    AND o.identity_issuer IS NOT NULL AND o.identity_subject IS NOT NULL
    AND o.credential_vault_reference IS NOT NULL)
 THEN RAISE EXCEPTION 'independent source officer required' USING ERRCODE='42501'; END IF;
 IF p_fdc_id !~ '^[1-9][0-9]*$' OR p_digest !~ '^[a-f0-9]{64}$'
  OR p_archive !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_core)<>'object'
  OR (SELECT count(*) FROM jsonb_object_keys(p_core))<>5
  OR p_core ?& ARRAY['energy_kcal','protein_g','carbohydrate_g','total_fat_g','sodium_mg'] IS NOT TRUE
 THEN RAISE EXCEPTION 'invalid exact source core evidence' USING ERRCODE='22023'; END IF;
 -- Numeric cast also denies strings that do not represent finite numerics.
 IF (p_core->>'energy_kcal')::numeric<0 OR (p_core->>'protein_g')::numeric<0
  OR (p_core->>'carbohydrate_g')::numeric<0 OR (p_core->>'total_fat_g')::numeric<0
  OR (p_core->>'sodium_mg')::numeric<0
 THEN RAISE EXCEPTION 'negative nutrient' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('usda-core:'||p_fdc_id,0));
 SELECT * INTO existing FROM allin_private.v2_ingredient_source_core_evidence
 WHERE provider='usda_fdc' AND source_data_type='Foundation'
 AND external_record_id=p_fdc_id AND source_payload_sha256=p_digest;
 IF FOUND THEN
  IF existing.archive_sha256<>p_archive OR existing.energy_kcal<>(p_core->>'energy_kcal')::numeric
   OR existing.protein_g<>(p_core->>'protein_g')::numeric
   OR existing.carbohydrate_g<>(p_core->>'carbohydrate_g')::numeric
   OR existing.total_fat_g<>(p_core->>'total_fat_g')::numeric
   OR existing.sodium_mg<>(p_core->>'sodium_mg')::numeric
   OR existing.source_releaser_db_login<>actor
  THEN RAISE EXCEPTION 'conflicting immutable source release' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('status','already_released','calculation_ready',false);
 END IF;
 INSERT INTO allin_private.v2_ingredient_source_core_evidence
 (provider,source_data_type,external_record_id,source_payload_sha256,archive_sha256,
 energy_kcal,protein_g,carbohydrate_g,total_fat_g,sodium_mg)
 VALUES('usda_fdc','Foundation',p_fdc_id,p_digest,p_archive,
 (p_core->>'energy_kcal')::numeric,(p_core->>'protein_g')::numeric,
 (p_core->>'carbohydrate_g')::numeric,(p_core->>'total_fat_g')::numeric,
 (p_core->>'sodium_mg')::numeric);
 RETURN jsonb_build_object('status','released','calculation_ready',false);
END $$;
REVOKE ALL ON FUNCTION allin_private.v2_release_ingredient_source_core(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer,allin_v2_ingredient_publisher;
GRANT EXECUTE ON FUNCTION allin_private.v2_release_ingredient_source_core(text,text,text,jsonb)
 TO allin_v2_ingredient_source_releaser;

CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_seed_events (
 request_id uuid PRIMARY KEY, actor_db_login name NOT NULL,
 ingredient_id uuid NOT NULL, profile_id uuid NOT NULL, source_record_id uuid NOT NULL,
 source_payload_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE allin_private.v2_ingredient_seed_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_seed_events FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;
CREATE TRIGGER v2_seed_events_immutable BEFORE UPDATE OR DELETE
ON allin_private.v2_ingredient_seed_events FOR EACH ROW
EXECUTE FUNCTION allin_private.v2_prevent_source_core_evidence_mutation();

CREATE OR REPLACE FUNCTION allin_private.v2_seed_ingredient_candidate(
 p_request uuid,p_ingredient uuid,p_profile uuid,p_source uuid,
 p_key text,p_name text,p_state text,p_fdc_id text,p_description text,
 p_digest text,p_archive text,p_core jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 actor name:=session_user;
 source_core allin_private.v2_ingredient_source_core_evidence%ROWTYPE;
 prior allin_private.v2_ingredient_seed_events%ROWTYPE;
 code text; amount numeric;
BEGIN
 IF actor::text IN ('postgres','anon','authenticated','service_role','authenticator')
 OR NOT pg_has_role(actor::text,'allin_v2_ingredient_reviewer','member')
 OR pg_has_role(actor::text,'allin_v2_ingredient_source_releaser','member')
 OR NOT EXISTS (SELECT 1 FROM allin_private.v2_ingredient_review_operators o
  WHERE o.login_role=actor AND o.enabled AND o.principal_kind='workload'
   AND o.identity_verified_at<=clock_timestamp()
   AND o.credential_expires_at>clock_timestamp() AND o.revoked_at IS NULL
   AND o.identity_issuer='allin-v2-internal-workload'
   AND o.identity_subject IS NOT NULL AND o.credential_vault_reference IS NOT NULL)
 THEN RAISE EXCEPTION 'restricted enrolled seed workload required' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_ingredient IS NULL OR p_profile IS NULL OR p_source IS NULL
 OR p_key IS NULL OR length(btrim(p_key))<3
 OR p_name IS NULL OR length(btrim(p_name))=0
 OR p_state NOT IN ('raw','cooked','cooked_drained','dry','as_sold','prepared')
 OR p_fdc_id !~ '^[1-9][0-9]*$' OR p_description IS NULL OR length(btrim(p_description))=0
 OR p_digest !~ '^[a-f0-9]{64}$' OR p_archive !~ '^[a-f0-9]{64}$'
 OR jsonb_typeof(p_core)<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_core))<>5
 OR p_core ?& ARRAY['energy_kcal','protein_g','carbohydrate_g','total_fat_g','sodium_mg'] IS NOT TRUE
 THEN RAISE EXCEPTION 'invalid canonical seed request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('usda-seed:'||p_fdc_id,0));
 SELECT * INTO prior FROM allin_private.v2_ingredient_seed_events WHERE request_id=p_request;
 IF FOUND THEN
  IF prior.actor_db_login<>actor OR prior.ingredient_id<>p_ingredient
   OR prior.profile_id<>p_profile OR prior.source_record_id<>p_source
   OR prior.source_payload_sha256<>p_digest
  THEN RAISE EXCEPTION 'seed request idempotency conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('status','already_seeded','calculation_ready',false);
 END IF;
 SELECT * INTO source_core FROM allin_private.v2_ingredient_source_core_evidence
 WHERE provider='usda_fdc' AND source_data_type='Foundation'
 AND external_record_id=p_fdc_id AND source_payload_sha256=p_digest FOR SHARE;
 IF NOT FOUND OR source_core.archive_sha256<>p_archive
  OR source_core.source_releaser_db_login=actor
  OR source_core.energy_kcal<>(p_core->>'energy_kcal')::numeric
  OR source_core.protein_g<>(p_core->>'protein_g')::numeric
  OR source_core.carbohydrate_g<>(p_core->>'carbohydrate_g')::numeric
  OR source_core.total_fat_g<>(p_core->>'total_fat_g')::numeric
  OR source_core.sodium_mg<>(p_core->>'sodium_mg')::numeric
 THEN RAISE EXCEPTION 'independent USDA core evidence mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_ingredient_source_records
  WHERE provider='usda_fdc' AND source_data_type='Foundation' AND external_record_id=p_fdc_id)
 THEN RAISE EXCEPTION 'source already mapped; use existing reconciliation path'
  USING ERRCODE='23505'; END IF;
 INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,normalized_name,identity_kind,status)
 VALUES(p_ingredient,p_key,p_name,lower(btrim(p_name)),'generic_food','active');
 INSERT INTO public.v2_ingredient_nutrition_profiles
 (id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,coverage_status,
  review_status,source_quality,profile_revision,required_nutrient_set_version,is_default)
 VALUES(p_profile,p_ingredient,p_state,'g',100,'100 g','launch_core_complete',
  'candidate','Foundation',1,'cookbook-launch-macros-v1',false);
 INSERT INTO public.v2_ingredient_source_records
 (id,ingredient_id,provider,source_data_type,external_record_id,source_description,
  source_quality,source_license,payload_sha256,mapping_status)
 VALUES(p_source,p_ingredient,'usda_fdc','Foundation',p_fdc_id,p_description,
  'independent_usda_evidence','CC0',p_digest,'mapped');
 INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role)
 VALUES(p_profile,p_source,'primary');
 FOR code,amount IN SELECT x.code,x.val FROM (VALUES
  ('energy_kcal',source_core.energy_kcal),('protein_g',source_core.protein_g),
  ('carbohydrate_g',source_core.carbohydrate_g),('total_fat_g',source_core.total_fat_g),
  ('sodium_mg',source_core.sodium_mg)) AS x(code,val)
 LOOP
  INSERT INTO public.v2_ingredient_profile_nutrients(profile_id,nutrient_code,amount)
  VALUES(p_profile,code,amount);
 END LOOP;
 -- Verify the stored normalized values, not only the caller-supplied JSON.
 IF (SELECT count(*) FROM public.v2_ingredient_profile_nutrients n
  WHERE n.profile_id=p_profile AND (
   (n.nutrient_code='energy_kcal' AND n.amount=source_core.energy_kcal) OR
   (n.nutrient_code='protein_g' AND n.amount=source_core.protein_g) OR
   (n.nutrient_code='carbohydrate_g' AND n.amount=source_core.carbohydrate_g) OR
   (n.nutrient_code='total_fat_g' AND n.amount=source_core.total_fat_g) OR
   (n.nutrient_code='sodium_mg' AND n.amount=source_core.sodium_mg)))<>5
 THEN RAISE EXCEPTION 'stored canonical core differs from released source evidence'
  USING ERRCODE='23514'; END IF;
 INSERT INTO allin_private.v2_ingredient_seed_events
 (request_id,actor_db_login,ingredient_id,profile_id,source_record_id,source_payload_sha256)
 VALUES(p_request,actor,p_ingredient,p_profile,p_source,p_digest);
 RETURN jsonb_build_object('status','candidate_seeded','profile_id',p_profile,
  'calculation_ready',false,'publication_approved',false);
END $$;
REVOKE ALL ON FUNCTION allin_private.v2_seed_ingredient_candidate(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_source_releaser,allin_v2_ingredient_publisher;
GRANT EXECUTE ON FUNCTION allin_private.v2_seed_ingredient_candidate(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)
 TO allin_v2_ingredient_reviewer;
-- No privileged workload login membership, no table DML grants, no live migration.
