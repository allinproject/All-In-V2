-- ALL-222 / ALL-228 — REVIEW-ONLY PostgreSQL canonical Ingredient Database transition writer
-- NOT A MIGRATION. DO NOT APPLY TO LIVE SUPABASE. Requires prior approval of
-- the canonical Ingredient Database DDL and operator authentication policy.
-- Assumes the table definitions in the existing physical ERD, not a parallel catalog.
-- PostgreSQL-backed actor identity is session_user from a separately authenticated
-- dedicated DB login, NEVER a JWT claim, caller UUID, service_role key, or GUC.
-- Review roles have NOLOGIN and no membership until explicit ops approval.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='allin_v2_ingredient_reviewer') THEN
    CREATE ROLE allin_v2_ingredient_reviewer NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- These are the private objects owned by the existing canonical domain.
-- No permissive policy and no athlete/anon/service grants.
CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_review_operators (
  login_role name PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrollment_reference text NOT NULL CHECK (length(trim(enrollment_reference)) >= 8)
);
CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_review_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_db_login name NOT NULL,
  idempotency_key uuid NOT NULL,
  request_payload jsonb NOT NULL,
  profile_id uuid NOT NULL,
  previous_status text NOT NULL,
  next_status text NOT NULL,
  previous_revision integer NOT NULL,
  next_revision integer NOT NULL,
  source_record_id uuid,
  decision_reason text NOT NULL,
  UNIQUE(actor_db_login, idempotency_key)
);
ALTER TABLE allin_private.v2_ingredient_review_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_ingredient_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_review_operators FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON allin_private.v2_ingredient_review_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON allin_private.v2_ingredient_review_events_event_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- No direct grants to the reviewer role: only the narrow checked owner function.

-- Do not grant athlete write access to the *existing canonical* product tables.
-- These eight objects are the proposed owner, NOT new copies.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.v2_ingredients,
  public.v2_ingredient_aliases,
  public.v2_ingredient_nutrition_profiles,
  public.v2_nutrient_definitions,
  public.v2_ingredient_profile_nutrients,
  public.v2_ingredient_source_records,
  public.v2_ingredient_profile_sources,
  public.v2_ingredient_measure_conversions
FROM PUBLIC, anon, authenticated, service_role, allin_v2_ingredient_reviewer;

-- Owner function executes only as the dedicated database reviewer role.
-- Requires separate trusted PostgreSQL login (session_user) explicitly enrolled
-- and granted role membership by controlled operators, never a pooled client.
CREATE OR REPLACE FUNCTION allin_private.v2_review_ingredient_profile_status(
  p_profile_id uuid,
  p_expected_revision integer,
  p_next_status text,
  p_reason text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, allin_private, pg_temp
AS $function$
DECLARE
  v_actor name := session_user;
  v_old public.v2_ingredient_nutrition_profiles%ROWTYPE;
  v_source uuid;
  v_source_count integer;
  v_ready_count integer;
  v_existing allin_private.v2_ingredient_review_events%ROWTYPE;
  v_payload jsonb;
  v_profile_kind text;
BEGIN
  -- Check BOTH database authentication/membership and positive enrollment.
  -- service_role / authenticated / anon must never be reviewer members.
  IF v_actor::text IN ('anon','authenticated','service_role','authenticator','postgres')
     OR NOT pg_has_role(v_actor::text,'allin_v2_ingredient_reviewer','member')
     OR NOT EXISTS (
       SELECT 1 FROM allin_private.v2_ingredient_review_operators o
       WHERE o.login_role=v_actor AND o.enabled=true
     ) THEN
    RAISE EXCEPTION 'unauthorized ingredient reviewer'
      USING ERRCODE='42501';
  END IF;
  IF p_profile_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
     OR p_next_status IS NULL OR p_next_status NOT IN
       ('needs_review','reviewed','calculation_ready','retired','superseded')
     OR p_reason IS NULL OR length(trim(p_reason))<12 OR length(p_reason)>2000
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid controlled profile review request'
      USING ERRCODE='22023';
  END IF;
  v_payload := jsonb_build_object(
    'profile_id',p_profile_id,'expected_revision',p_expected_revision,
    'next_status',p_next_status,'reason',p_reason
  );
  -- Whole-key lock serializes replay even on two independent connections.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_idempotency_key::text,0));
  SELECT * INTO v_existing
    FROM allin_private.v2_ingredient_review_events
    WHERE actor_db_login=v_actor AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_payload<>v_payload THEN
      RAISE EXCEPTION 'idempotency key used for different request'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('status','replayed',
      'profile_id',v_existing.profile_id,'review_status',v_existing.next_status,
      'profile_revision',v_existing.next_revision,'event_id',v_existing.event_id);
  END IF;

  SELECT * INTO v_old FROM public.v2_ingredient_nutrition_profiles
    WHERE id=p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingredient nutrition profile not found'
      USING ERRCODE='P0002';
  END IF;
  IF v_old.profile_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'stale ingredient profile review'
      USING ERRCODE='40001';
  END IF;
  IF NOT (
    (v_old.review_status='candidate' AND p_next_status='needs_review') OR
    (v_old.review_status='needs_review' AND p_next_status='reviewed') OR
    (v_old.review_status='reviewed' AND p_next_status IN ('needs_review','calculation_ready')) OR
    (v_old.review_status='calculation_ready' AND p_next_status IN ('retired','superseded'))
  ) THEN
    RAISE EXCEPTION 'forbidden profile review transition'
      USING ERRCODE='23514';
  END IF;

  SELECT i.identity_kind INTO v_profile_kind
    FROM public.v2_ingredients i WHERE i.id=v_old.ingredient_id AND i.status='active';
  IF v_profile_kind IS NULL THEN
    RAISE EXCEPTION 'source ingredient identity not active'
      USING ERRCODE='23514';
  END IF;
  SELECT count(*),(array_agg(s.id))[1] INTO v_source_count,v_source
    FROM public.v2_ingredient_profile_sources ps
    JOIN public.v2_ingredient_source_records s ON s.id=ps.source_record_id
    WHERE ps.profile_id=p_profile_id AND ps.evidence_role='primary'
      AND s.ingredient_id=v_old.ingredient_id AND s.mapping_status='mapped'
      AND s.payload_sha256 ~ '^[a-fA-F0-9]{64}$';
  IF v_source_count<>1 THEN
    RAISE EXCEPTION 'exactly one approved primary source link required'
      USING ERRCODE='23514';
  END IF;

  IF p_next_status='calculation_ready' THEN
    -- Numeric facts are stored in the canonical normalized nutrient table.
    -- Missing core values do not count as zero. Status alone cannot approve.
    IF v_old.coverage_status NOT IN ('launch_core_complete','expanded_profile')
       OR v_old.required_nutrient_set_version<>'cookbook-launch-macros-v1'
       OR v_old.basis_unit<>'g' OR v_old.basis_quantity<>100
       OR NOT EXISTS (
         SELECT 1 FROM public.v2_ingredient_aliases a
          WHERE a.ingredient_id=v_old.ingredient_id AND a.status='active'
            AND a.preparation_state=v_old.preparation_state
       )
       OR (SELECT count(*) FROM public.v2_ingredient_profile_nutrients n
          JOIN public.v2_nutrient_definitions d ON d.code=n.nutrient_code
          WHERE n.profile_id=p_profile_id AND n.nutrient_code IN
             ('energy_kcal','protein_g','carbohydrate_g','total_fat_g')
            AND n.amount>=0 AND (
              (n.nutrient_code='energy_kcal' AND d.canonical_unit='kcal') OR
              (n.nutrient_code<>'energy_kcal' AND d.canonical_unit='g')
            ))<>4
       OR (SELECT count(*) FROM public.v2_ingredient_nutrition_profiles other
           WHERE other.ingredient_id=v_old.ingredient_id
             AND other.preparation_state=v_old.preparation_state
             AND other.basis_unit=v_old.basis_unit
             AND other.review_status='calculation_ready'
             AND other.is_default AND other.id<>p_profile_id)>0
    THEN
      RAISE EXCEPTION 'profile missing approved launch-core/state/basis/alias evidence'
        USING ERRCODE='23514';
    END IF;
    -- Conditional sodium requires separately recorded source-form evidence.
    -- Default fails closed for the eight founder-reviewed USDA candidates.
    IF EXISTS (
       SELECT 1 FROM public.v2_ingredient_source_records s
        WHERE s.id=v_source AND s.provider='usda_fdc'
          AND s.source_data_type='Foundation'
          AND s.external_record_id IN
            ('328841','790577','2346407','2644285','2644288','2644289','2685580','2685581')
    ) AND NOT EXISTS (
       SELECT 1 FROM public.v2_ingredient_profile_nutrients n
        JOIN public.v2_nutrient_definitions d ON d.code=n.nutrient_code
        WHERE n.profile_id=p_profile_id AND n.nutrient_code='sodium_mg'
          AND d.canonical_unit='mg' AND n.amount>=0
    ) THEN
      RAISE EXCEPTION 'reviewed-source sodium evidence missing'
        USING ERRCODE='23514';
    END IF;
    -- The canonical schema does NOT YET persist the immutable ALL-225 energy
    -- method ID/source-revision attestation and ALL-251 authenticated operator
    -- governance. Prevent premature publication rather than guessing.
    RAISE EXCEPTION 'calculation_ready blocked pending method attestation and ALL-222/251 acceptance'
      USING ERRCODE='0A000';
  END IF;

  -- The row lock is held until the transaction and audit commit together.
  UPDATE public.v2_ingredient_nutrition_profiles
     SET review_status=p_next_status,
         profile_revision=v_old.profile_revision+1,
         reviewed_at=clock_timestamp(),
         updated_at=clock_timestamp()
   WHERE id=p_profile_id AND profile_revision=p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrent ingredient profile update refused'
      USING ERRCODE='40001';
  END IF;
  INSERT INTO allin_private.v2_ingredient_review_events
    (actor_db_login,idempotency_key,request_payload,profile_id,previous_status,
     next_status,previous_revision,next_revision,source_record_id,decision_reason)
  VALUES (v_actor,p_idempotency_key,v_payload,p_profile_id,v_old.review_status,
          p_next_status,v_old.profile_revision,v_old.profile_revision+1,v_source,p_reason)
  RETURNING * INTO v_existing;
  RETURN jsonb_build_object('status','reviewed',
    'profile_id',p_profile_id,'review_status',p_next_status,
    'profile_revision',v_old.profile_revision+1,'event_id',v_existing.event_id);
END;
$function$;

REVOKE ALL ON FUNCTION allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,uuid)
  TO allin_v2_ingredient_reviewer;
-- Intentionally NO GRANT of role membership to ANY login. No API route.
-- This candidate MUST NEVER be directly deployed before owner approval.
