-- ALL-225 / ALL-222: versioned USDA Foundation energy-method attestation.
-- REVIEW ONLY. NOT A DEPLOYABLE MIGRATION. Not an import, no publication.
-- Depends on canonical catalog candidate + private reviewer writer candidate.
-- NO client-supplied attestation, fabricated calories or fallback to FDC 2047.
-- Evidence rows are seeded only by separately reviewed source-release tooling;
-- no reviewer function here can create/modify those source measurements.

CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_source_energy_evidence (
  source_record_id uuid NOT NULL REFERENCES public.v2_ingredient_source_records(id),
  source_payload_sha256 text NOT NULL CHECK (source_payload_sha256 ~ '^[0-9a-fA-F]{64}$'),
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-fA-F]{64}$'),
  fdc_nutrient_id integer NOT NULL CHECK (fdc_nutrient_id IN (2048,2047,1008)),
  energy_kcal numeric NOT NULL CHECK (energy_kcal >= 0),
  basis_quantity integer NOT NULL DEFAULT 100 CHECK (basis_quantity = 100),
  basis_unit text NOT NULL DEFAULT 'g' CHECK (basis_unit='g'),
  nutrient_unit text NOT NULL DEFAULT 'kcal' CHECK (nutrient_unit='kcal'),
  source_review_reference text NOT NULL CHECK (length(trim(source_review_reference)) >= 12),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_record_id,source_payload_sha256,fdc_nutrient_id)
);

CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_energy_attestations (
  attestation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.v2_ingredient_nutrition_profiles(id),
  profile_revision integer NOT NULL CHECK (profile_revision > 0),
  source_record_id uuid NOT NULL REFERENCES public.v2_ingredient_source_records(id),
  source_payload_sha256 text NOT NULL CHECK (source_payload_sha256 ~ '^[0-9a-fA-F]{64}$'),
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-fA-F]{64}$'),
  energy_policy_version text NOT NULL CHECK (energy_policy_version='usda-fdc-energy-specific-legacy-v1'),
  required_nutrient_set_version text NOT NULL CHECK (required_nutrient_set_version='cookbook-launch-macros-v1'),
  selected_fdc_nutrient_id integer NOT NULL CHECK (selected_fdc_nutrient_id IN (2048,1008)),
  selected_energy_kcal numeric NOT NULL CHECK (selected_energy_kcal>=0),
  reviewer_db_login name NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason))>=12),
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(profile_id,profile_revision)
);

ALTER TABLE allin_private.v2_ingredient_source_energy_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_ingredient_energy_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_source_energy_evidence
  FROM PUBLIC, anon, authenticated, service_role, allin_v2_ingredient_reviewer;
REVOKE ALL ON allin_private.v2_ingredient_energy_attestations
  FROM PUBLIC, anon, authenticated, service_role, allin_v2_ingredient_reviewer;
REVOKE ALL ON SEQUENCE allin_private.v2_ingredient_energy_attestations_attestation_id_seq
  FROM PUBLIC, anon, authenticated, service_role, allin_v2_ingredient_reviewer;

-- Reject alterations to imported source energy evidence and signed decisions.
-- Uses the existing immutable audit trigger, deliberately not another ledger.
DROP TRIGGER IF EXISTS v2_ingredient_source_energy_immutable
 ON allin_private.v2_ingredient_source_energy_evidence;
CREATE TRIGGER v2_ingredient_source_energy_immutable
 BEFORE UPDATE OR DELETE ON allin_private.v2_ingredient_source_energy_evidence
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_review_audit_change();

DROP TRIGGER IF EXISTS v2_ingredient_energy_attestation_immutable
 ON allin_private.v2_ingredient_energy_attestations;
CREATE TRIGGER v2_ingredient_energy_attestation_immutable
 BEFORE UPDATE OR DELETE ON allin_private.v2_ingredient_energy_attestations
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_review_audit_change();

CREATE OR REPLACE FUNCTION allin_private.v2_attest_ingredient_energy(
  p_profile_id uuid,
  p_expected_revision integer,
  p_expected_source_sha256 text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, allin_private, pg_temp
AS $attestation$
DECLARE
  v_actor name := session_user;
  v_profile public.v2_ingredient_nutrition_profiles%ROWTYPE;
  v_source public.v2_ingredient_source_records%ROWTYPE;
  v_source_links integer;
  v_evidence allin_private.v2_ingredient_source_energy_evidence%ROWTYPE;
  v_attested allin_private.v2_ingredient_energy_attestations%ROWTYPE;
  v_method integer;
  v_archive text;
  v_core_kcal numeric;
  v_count integer;
BEGIN
  IF v_actor::text IN ('anon','authenticated','service_role','authenticator','postgres')
    OR NOT pg_has_role(v_actor::text,'allin_v2_ingredient_reviewer','member')
    OR NOT EXISTS (SELECT 1 FROM allin_private.v2_ingredient_review_operators o
       WHERE o.login_role=v_actor AND o.enabled=true
         AND o.identity_issuer IS NOT NULL AND o.identity_subject IS NOT NULL
         AND o.identity_verified_at IS NOT NULL
         AND o.credential_vault_reference IS NOT NULL
         AND o.credential_expires_at > clock_timestamp()
         AND o.revoked_at IS NULL
       FOR SHARE OF o)
  THEN
    RAISE EXCEPTION 'unauthorized ingredient energy reviewer' USING ERRCODE='42501';
  END IF;
  IF p_profile_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
     OR p_expected_source_sha256 IS NULL OR p_expected_source_sha256 !~ '^[0-9a-fA-F]{64}$'
     OR p_reason IS NULL OR length(trim(p_reason))<12 OR length(p_reason)>2000
  THEN
    RAISE EXCEPTION 'invalid energy attestation request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_profile FROM public.v2_ingredient_nutrition_profiles
    WHERE id=p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_profile.profile_revision<>p_expected_revision OR v_profile.review_status<>'reviewed'
     OR v_profile.coverage_status NOT IN ('launch_core_complete','expanded_profile')
     OR v_profile.basis_unit<>'g' OR v_profile.basis_quantity<>100
     OR v_profile.required_nutrient_set_version<>'cookbook-launch-macros-v1'
  THEN
    RAISE EXCEPTION 'stale or nonreviewed profile' USING ERRCODE='40001';
  END IF;
  SELECT count(*) INTO v_source_links
    FROM public.v2_ingredient_profile_sources ps
    JOIN public.v2_ingredient_source_records s ON s.id=ps.source_record_id
    WHERE ps.profile_id=p_profile_id AND ps.evidence_role='primary'
      AND s.ingredient_id=v_profile.ingredient_id AND s.mapping_status='mapped'
      AND s.provider='usda_fdc' AND s.source_data_type='Foundation';
  IF v_source_links<>1 THEN
    RAISE EXCEPTION 'one mapped USDA Foundation primary source required' USING ERRCODE='23514';
  END IF;
  SELECT s.* INTO v_source
    FROM public.v2_ingredient_profile_sources ps
    JOIN public.v2_ingredient_source_records s ON s.id=ps.source_record_id
    WHERE ps.profile_id=p_profile_id AND ps.evidence_role='primary'
      AND s.ingredient_id=v_profile.ingredient_id AND s.mapping_status='mapped'
      AND s.provider='usda_fdc' AND s.source_data_type='Foundation'
    FOR SHARE OF s;
  IF lower(v_source.payload_sha256)<>lower(p_expected_source_sha256) THEN
    RAISE EXCEPTION 'stale USDA source digest' USING ERRCODE='40001';
  END IF;

  -- Source data come from the immutable reviewed archive, not from RPC args.
  -- Must have ONE consistent archive SHA for all reported energy methods.
  SELECT count(DISTINCT lower(e.archive_sha256)) INTO v_count
    FROM allin_private.v2_ingredient_source_energy_evidence e
    WHERE e.source_record_id=v_source.id
      AND lower(e.source_payload_sha256)=lower(v_source.payload_sha256);
  IF v_count<>1 THEN
    RAISE EXCEPTION 'ambiguous or missing source archive evidence' USING ERRCODE='23514';
  END IF;

  SELECT e.* INTO v_evidence
    FROM allin_private.v2_ingredient_source_energy_evidence e
    WHERE e.source_record_id=v_source.id
      AND lower(e.source_payload_sha256)=lower(v_source.payload_sha256)
      AND e.fdc_nutrient_id=2048;
  IF FOUND THEN
    v_method:=2048;
  ELSE
    SELECT e.* INTO v_evidence
      FROM allin_private.v2_ingredient_source_energy_evidence e
      WHERE e.source_record_id=v_source.id
        AND lower(e.source_payload_sha256)=lower(v_source.payload_sha256)
        AND e.fdc_nutrient_id=1008;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no approved USDA energy method; 2047 alone is insufficient' USING ERRCODE='23514';
    END IF;
    v_method:=1008;
  END IF;

  SELECT n.amount INTO v_core_kcal
    FROM public.v2_ingredient_profile_nutrients n
    JOIN public.v2_nutrient_definitions d ON d.code=n.nutrient_code
    WHERE n.profile_id=p_profile_id AND n.nutrient_code='energy_kcal' AND d.canonical_unit='kcal';
  IF v_core_kcal IS NULL OR v_core_kcal<>v_evidence.energy_kcal THEN
    RAISE EXCEPTION 'normalized energy differs from selected USDA source' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM public.v2_ingredient_profile_nutrients n
       JOIN public.v2_nutrient_definitions d ON d.code=n.nutrient_code
       WHERE n.profile_id=p_profile_id AND (
       (n.nutrient_code='energy_kcal' AND d.canonical_unit='kcal') OR
       (n.nutrient_code IN ('protein_g','carbohydrate_g','total_fat_g') AND d.canonical_unit='g')
       ))<>4 THEN
    RAISE EXCEPTION 'launch core macros incomplete' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_attested
    FROM allin_private.v2_ingredient_energy_attestations
    WHERE profile_id=p_profile_id AND profile_revision=p_expected_revision;
  IF FOUND THEN
    IF v_attested.source_record_id<>v_source.id OR
       lower(v_attested.source_payload_sha256)<>lower(v_source.payload_sha256) OR
       v_attested.selected_fdc_nutrient_id<>v_method OR
       v_attested.selected_energy_kcal<>v_evidence.energy_kcal
    THEN
      RAISE EXCEPTION 'conflicting existing attestation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('status','already_attested','attestation_id',v_attested.attestation_id);
  END IF;
  INSERT INTO allin_private.v2_ingredient_energy_attestations
   (profile_id,profile_revision,source_record_id,source_payload_sha256,archive_sha256,
    energy_policy_version,required_nutrient_set_version,selected_fdc_nutrient_id,
    selected_energy_kcal,reviewer_db_login,reason)
  VALUES(p_profile_id,p_expected_revision,v_source.id,v_source.payload_sha256,v_evidence.archive_sha256,
   'usda-fdc-energy-specific-legacy-v1','cookbook-launch-macros-v1',v_method,
   v_evidence.energy_kcal,v_actor,p_reason)
  RETURNING * INTO v_attested;
  RETURN jsonb_build_object('status','attested','attestation_id',v_attested.attestation_id,
    'source_record_id',v_source.id,'energy_fdc_nutrient_id',v_method,
    'energy_kcal',v_evidence.energy_kcal,'calculation_ready',false);
END;
$attestation$;

REVOKE ALL ON FUNCTION allin_private.v2_attest_ingredient_energy(uuid,integer,text,text)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_attest_ingredient_energy(uuid,integer,text,text)
 TO allin_v2_ingredient_reviewer;

-- IMPORTANT: The existing v2_review_ingredient_profile_status() keeps its
-- unconditional calculation_ready denial. An attestation is necessary but
-- not a sufficient publication authorization. No operator is enrolled here.
