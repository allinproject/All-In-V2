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
SET search_path = pg_catalog, pg_temp
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
         AND o.identity_verified_at IS NOT NULL AND o.identity_verified_at <= clock_timestamp()
         AND o.credential_vault_reference IS NOT NULL
         AND o.credential_expires_at > clock_timestamp()
         AND o.revoked_at IS NULL
       FOR SHARE OF o)
  THEN
    RAISE EXCEPTION 'unauthorized ingredient energy reviewer' USING ERRCODE='42501';
  END IF;
  -- Automated ingest workload may attest ONLY to stored, immutable source
  -- evidence via the same identity-gated function. No caller-supplied energy,
  -- archive digest, nutrient method or publication flag is accepted. This
  -- records evidence only; calculation_ready remains unconditionally blocked
  -- in the existing canonical status writer until separate release acceptance.
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
  SELECT min(lower(e.archive_sha256)) INTO v_archive
    FROM allin_private.v2_ingredient_source_energy_evidence e
    WHERE e.source_record_id=v_source.id
      AND lower(e.source_payload_sha256)=lower(v_source.payload_sha256);
  -- ALL-225 v1 is tied to the independently SHA-verified Foundation
  -- 2026-10-29 archive. A subsequent release needs a separately reviewed
  -- source version and attestation policy before acceptance.
  IF v_archive<> 'dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579' THEN
    RAISE EXCEPTION 'unapproved USDA Foundation archive revision' USING ERRCODE='23514';
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

-- ALL-228 independently authorized source-release capability.
-- CANDIDATE ONLY; NEVER deploy without ALL-222/ALL-12 recovery and release
-- acceptance. This is a distinct role from the canonical reviewer/publisher.
-- An actual source officer must verify the original USDA archive off-database
-- with the pinned ZIP tool before issuing this decision; PostgreSQL does not
-- have access to those original ZIP bytes and cannot prove that step itself.
DO $source_release_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='allin_v2_ingredient_source_releaser') THEN
    CREATE ROLE allin_v2_ingredient_source_releaser NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END;
$source_release_role$;
GRANT USAGE ON SCHEMA allin_private TO allin_v2_ingredient_source_releaser;
REVOKE ALL ON allin_private.v2_ingredient_source_energy_evidence
 FROM allin_v2_ingredient_source_releaser;
REVOKE ALL ON allin_private.v2_ingredient_energy_attestations
 FROM allin_v2_ingredient_source_releaser;

-- Source release is the ONLY private evidence INSERT path exposed to the
-- restricted independent officer. Reviewer/member/workload accounts cannot
-- certify their own evidence, and no publisher grant is created.
CREATE OR REPLACE FUNCTION allin_private.v2_release_ingredient_source_energy(
  p_source_id uuid,
  p_expected_payload_sha256 text,
  p_archive_sha256 text,
  p_methods jsonb,
  p_source_review_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $source_release$
DECLARE
  v_actor name := session_user;
  v_source public.v2_ingredient_source_records%ROWTYPE;
  v_pinned_sha text;
  v_pinned_methods jsonb;
  v_row record;
  v_current allin_private.v2_ingredient_source_energy_evidence%ROWTYPE;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_count integer;
BEGIN
  IF v_actor::text IN ('postgres','anon','authenticated','service_role','authenticator')
     OR NOT pg_has_role(v_actor::text,'allin_v2_ingredient_source_releaser','member')
     OR pg_has_role(v_actor::text,'allin_v2_ingredient_reviewer','member')
     OR pg_has_role(v_actor::text,'allin_v2_ingredient_publisher','member')
     OR NOT EXISTS (
       SELECT 1 FROM allin_private.v2_ingredient_review_operators o
       WHERE o.login_role=v_actor AND o.enabled=true AND o.revoked_at IS NULL
         AND o.identity_issuer IS NOT NULL AND o.identity_subject IS NOT NULL
         AND o.identity_verified_at IS NOT NULL AND o.identity_verified_at<=clock_timestamp()
         AND o.credential_vault_reference IS NOT NULL
         AND o.credential_expires_at>clock_timestamp()
       FOR SHARE OF o
     )
  THEN RAISE EXCEPTION 'unauthorized independent USDA source releaser' USING ERRCODE='42501';
  END IF;
  IF p_source_id IS NULL OR p_expected_payload_sha256 IS NULL
     OR p_expected_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_archive_sha256 IS NULL
     OR p_archive_sha256 <> 'dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579'
     OR p_methods IS NULL OR jsonb_typeof(p_methods)<>'array'
     OR p_source_review_reference IS NULL
     OR length(trim(p_source_review_reference))<12 OR length(p_source_review_reference)>2000
  THEN RAISE EXCEPTION 'invalid controlled USDA source-release input' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_source FROM public.v2_ingredient_source_records
     WHERE id=p_source_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source record unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_source.provider<>'usda_fdc' OR v_source.source_data_type<>'Foundation'
     OR v_source.mapping_status<>'mapped' OR v_source.ingredient_id IS NULL
     OR lower(v_source.payload_sha256)<>p_expected_payload_sha256
     OR v_source.source_license<>'CC0'
  THEN RAISE EXCEPTION 'source record is not a pinned mapped Foundation food' USING ERRCODE='23514';
  END IF;
  CASE v_source.external_record_id
    WHEN '328841' THEN
      v_pinned_sha := '77cf3ae438814c51bb5ef732b14a6f2643fa54b5c428f0104354c24473368323';
      v_pinned_methods := '[{"nutrientId":1008,"kcal":84}]'::jsonb;
    WHEN '790577' THEN
      v_pinned_sha := '0b8fc2d591a88381aa11cf0e3041f3b3f30ef4a660d68f74e3f483214f6d8b51';
      v_pinned_methods := '[{"nutrientId":1008,"kcal":44}]'::jsonb;
    WHEN '2346407' THEN
      v_pinned_sha := '88bec4819f0243de72ad7ada9f6f4f9295e66f3e19892710d4757adc41d70b8f';
      v_pinned_methods := '[{"nutrientId":2048,"kcal":27.9},{"nutrientId":2047,"kcal":31.4}]'::jsonb;
    WHEN '2644285' THEN
      v_pinned_sha := 'b2e32066eeb463137d35b84670e3c26504c5fa62f32734946a8b59e404d4e2e6';
      v_pinned_methods := '[{"nutrientId":2048,"kcal":115},{"nutrientId":2047,"kcal":118}]'::jsonb;
    WHEN '2644288' THEN
      v_pinned_sha := 'd369e999d09bc5e73742bcfd466350874a3671f6c96f9d916c6cecff5787f08f';
      v_pinned_methods := '[{"nutrientId":2048,"kcal":133},{"nutrientId":2047,"kcal":137}]'::jsonb;
    WHEN '2644289' THEN
      v_pinned_sha := '9666e868d07842fc3f6e69a904b7aa7cf4b8607342fdc9391210168d98b28224';
      v_pinned_methods := '[{"nutrientId":2048,"kcal":123},{"nutrientId":2047,"kcal":127}]'::jsonb;
    WHEN '2685580' THEN
      v_pinned_sha := '020baa3671721a0d4fea358fd729afd3b06eb39f5d46166a81061805748a41ed';
      v_pinned_methods := '[{"nutrientId":2048,"kcal":88.5},{"nutrientId":2047,"kcal":104}]'::jsonb;
    WHEN '2685581' THEN
      v_pinned_sha := 'de8faf99cdeb9b24b9ac84bfee58e1ff1dcd1ab576919794946c400f8be39121';
      v_pinned_methods := '[{"nutrientId":2048,"kcal":32.3},{"nutrientId":2047,"kcal":37.9}]'::jsonb;
    ELSE
      RAISE EXCEPTION 'unapproved USDA Foundation source record' USING ERRCODE='23514';
  END CASE;
  IF v_pinned_sha<>p_expected_payload_sha256 OR v_pinned_methods<>p_methods THEN
    RAISE EXCEPTION 'USDA source payload or energy observations differ from pinned release' USING ERRCODE='23514';
  END IF;
  -- Existing release can only replay if *every* energy observation agrees;
  -- a conflicting or incomplete immutable set fails closed, never repaired
  -- by an update/delete or by adding a missing method implicitly.
  SELECT count(*) INTO v_count
    FROM allin_private.v2_ingredient_source_energy_evidence
    WHERE source_record_id=p_source_id;
  IF v_count<>0 AND v_count<>jsonb_array_length(v_pinned_methods) THEN
    RAISE EXCEPTION 'incomplete existing immutable USDA source release' USING ERRCODE='23514';
  END IF;
  FOR v_row IN SELECT (item->>'nutrientId')::integer AS nutrient_id,
                       (item->>'kcal')::numeric AS kcal
      FROM jsonb_array_elements(v_pinned_methods) item
  LOOP
    SELECT * INTO v_current FROM allin_private.v2_ingredient_source_energy_evidence
      WHERE source_record_id=p_source_id AND fdc_nutrient_id=v_row.nutrient_id;
    IF FOUND THEN
      IF lower(v_current.source_payload_sha256)<>p_expected_payload_sha256
         OR lower(v_current.archive_sha256)<>p_archive_sha256
         OR v_current.energy_kcal<>v_row.kcal
         OR v_current.basis_quantity<>100 OR v_current.basis_unit<>'g'
         OR v_current.nutrient_unit<>'kcal'
      THEN RAISE EXCEPTION 'conflicting immutable USDA source release' USING ERRCODE='23514';
      END IF;
      v_existing := v_existing+1;
    ELSE
      IF v_count<>0 THEN
        RAISE EXCEPTION 'partial or conflicting immutable USDA source release'
          USING ERRCODE='23514';
      END IF;
      INSERT INTO allin_private.v2_ingredient_source_energy_evidence
       (source_record_id,source_payload_sha256,archive_sha256,
        fdc_nutrient_id,energy_kcal,source_review_reference)
      VALUES(p_source_id,p_expected_payload_sha256,p_archive_sha256,
             v_row.nutrient_id,v_row.kcal,p_source_review_reference);
      v_inserted:=v_inserted+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('status',
    CASE WHEN v_inserted=0 THEN 'already_released' ELSE 'released' END,
    'source_record_id',p_source_id,'evidence_count',v_inserted+v_existing,
    'archive_sha256',p_archive_sha256,
    'calculation_ready',false,'publication_approved',false);
END;
$source_release$;
REVOKE ALL ON FUNCTION allin_private.v2_release_ingredient_source_energy(uuid,text,text,jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer,
       allin_v2_ingredient_publisher;
GRANT EXECUTE ON FUNCTION allin_private.v2_release_ingredient_source_energy(uuid,text,text,jsonb,text)
  TO allin_v2_ingredient_source_releaser;
