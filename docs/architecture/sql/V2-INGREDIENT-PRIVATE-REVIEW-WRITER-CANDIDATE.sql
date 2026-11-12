-- ALL-222 / ALL-228 / ALL-225 — REVIEW-ONLY CANDIDATE, NOT A MIGRATION.
-- DO NOT APPLY TO LIVE/STAGING WITHOUT SEPARATE PHYSICAL MODEL, RLS,
-- OPERATOR-ROLE, RELEASE AND MIGRATION APPROVALS.
-- Requires the proposed public.v2_ingredient_* tables and auth.users.
-- This extends the proposed canonical ingredient review/audit ownership.
-- Server gateway MUST call Supabase Auth getUser(bearer) (not decode a JWT)
-- and bind ONLY the verified user.id as p_actor_id. The database cannot
-- authenticate a bearer token passed through a service connection.
-- NO grant to anon/authenticated/service_role; no HTTP/Edge function deployed.
BEGIN;
CREATE SCHEMA IF NOT EXISTS allin_private;

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='allin_v2_ingredient_review_executor') THEN
   CREATE ROLE allin_v2_ingredient_review_executor NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;

-- ALL-222 operator enrollment is OWNER-managed, never self-service.
CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_review_authorizations (
 reviewer_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 capability text NOT NULL CHECK (capability IN ('reviewer','publisher')),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL,
 approved_by uuid NOT NULL REFERENCES auth.users(id),
 approved_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK (approved_by <> reviewer_user_id)
);
ALTER TABLE allin_private.v2_ingredient_review_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_review_authorizations FROM PUBLIC, anon, authenticated, service_role;

-- The authoritative private audit table is described by ALL-228's physical
-- ERD. This candidate defines its minimum executable fields for the writer.
CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action_id uuid NOT NULL,
 ingredient_id uuid NOT NULL REFERENCES public.v2_ingredients(id),
 profile_id uuid NOT NULL REFERENCES public.v2_ingredient_nutrition_profiles(id),
 source_record_id uuid NOT NULL REFERENCES public.v2_ingredient_source_records(id),
 action text NOT NULL CHECK(action IN ('review','publish')),
 prior_status text NOT NULL,
 new_status text NOT NULL,
 prior_revision integer NOT NULL,
 new_revision integer NOT NULL,
 evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
 source_payload_sha256 text NOT NULL CHECK (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
 energy_policy_version text NOT NULL,
 nutrient_set_version text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE (actor_user_id, action_id),
 CHECK (new_revision = prior_revision + 1)
);
ALTER TABLE allin_private.v2_ingredient_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_review_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION allin_private.v2_ingredient_review_event_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'ingredient review audit events are append-only' USING ERRCODE='42501';
END $$;
DROP TRIGGER IF EXISTS v2_ingredient_review_events_immutable ON allin_private.v2_ingredient_review_events;
CREATE TRIGGER v2_ingredient_review_events_immutable
BEFORE UPDATE OR DELETE ON allin_private.v2_ingredient_review_events
FOR EACH ROW EXECUTE FUNCTION allin_private.v2_ingredient_review_event_immutable();

CREATE OR REPLACE FUNCTION allin_private.v2_ingredient_review_profile(
 p_actor_id uuid, p_action_id uuid, p_profile_id uuid,
 p_expected_revision integer, p_source_record_id uuid,
 p_source_payload_sha256 text, p_evidence_sha256 text,
 p_energy_policy_version text, p_nutrient_set_version text,
 p_action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
 v_capability text;
 v_enabled boolean;
 v_expires_at timestamptz;
 v_profile public.v2_ingredient_nutrition_profiles%ROWTYPE;
 v_source public.v2_ingredient_source_records%ROWTYPE;
 v_ingredient public.v2_ingredients%ROWTYPE;
 v_event allin_private.v2_ingredient_review_events%ROWTYPE;
 v_target text;
 v_missing text[];
BEGIN
 -- This function must be owned by a tightly-controlled owner, not an
 -- athlete/service_role login. Dedicated server-only executor membership
 -- must be provisioned and reviewed separately; no Data API exposure.
 IF p_actor_id IS NULL OR p_action_id IS NULL OR p_profile_id IS NULL OR
    p_source_record_id IS NULL OR p_expected_revision IS NULL OR
    p_expected_revision < 1 OR p_action NOT IN ('review','publish') OR
    p_source_payload_sha256 !~ '^[0-9a-f]{64}$' OR
    p_evidence_sha256 !~ '^[0-9a-f]{64}$' OR
    p_energy_policy_version <> 'usda-fdc-energy-specific-legacy-v1' OR
    p_nutrient_set_version <> 'cookbook-launch-macros-v1' THEN
   RAISE EXCEPTION 'invalid review command' USING ERRCODE='22023';
 END IF;
 SELECT capability,enabled,expires_at
 INTO v_capability,v_enabled,v_expires_at
 FROM allin_private.v2_ingredient_review_authorizations
 WHERE reviewer_user_id=p_actor_id;
 IF NOT FOUND OR v_enabled IS DISTINCT FROM true OR
    v_expires_at<=transaction_timestamp() OR
    (p_action='publish' AND v_capability <> 'publisher') THEN
   RAISE EXCEPTION 'reviewer not authorized' USING ERRCODE='42501';
 END IF;
 -- Serialize action retries across different profile IDs as well.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_action_id::text, 20261112));
 SELECT * INTO v_event FROM allin_private.v2_ingredient_review_events
 WHERE actor_user_id=p_actor_id AND action_id=p_action_id;
 IF FOUND THEN
   IF v_event.profile_id<>p_profile_id OR
      v_event.source_record_id<>p_source_record_id OR
      v_event.action<>p_action OR
      v_event.prior_revision<>p_expected_revision OR
      v_event.evidence_sha256<>p_evidence_sha256 OR
      v_event.source_payload_sha256<>p_source_payload_sha256 OR
      v_event.energy_policy_version<>p_energy_policy_version OR
      v_event.nutrient_set_version<>p_nutrient_set_version THEN
     RAISE EXCEPTION 'idempotency key reused with different command' USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object('status','idempotent_replay',
     'profile_id',v_event.profile_id,'revision',v_event.new_revision,
     'review_status',v_event.new_status);
 END IF;
 SELECT * INTO v_profile FROM public.v2_ingredient_nutrition_profiles
 WHERE id=p_profile_id FOR UPDATE;
 IF NOT FOUND OR v_profile.profile_revision<>p_expected_revision THEN
   RAISE EXCEPTION 'missing or stale ingredient profile' USING ERRCODE='40001';
 END IF;
 SELECT * INTO v_ingredient FROM public.v2_ingredients
 WHERE id=v_profile.ingredient_id AND status='active';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'inactive ingredient identity' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_source FROM public.v2_ingredient_source_records
 WHERE id=p_source_record_id AND ingredient_id=v_profile.ingredient_id
   AND provider='usda_fdc' AND source_data_type='Foundation'
   AND mapping_status='mapped' AND payload_sha256=p_source_payload_sha256;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'missing/mismatched verified USDA source mapping' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.v2_ingredient_profile_sources
   WHERE profile_id=p_profile_id AND source_record_id=p_source_record_id AND evidence_role='primary') THEN
   RAISE EXCEPTION 'profile primary source relation missing' USING ERRCODE='23514';
 END IF;
 IF v_profile.basis_unit<>'g' OR v_profile.basis_quantity<>100 OR
    v_profile.required_nutrient_set_version<>p_nutrient_set_version OR
    v_profile.preparation_state NOT IN ('raw','prepared','cooked_drained') THEN
   RAISE EXCEPTION 'unreviewed nutrient basis/state/version' USING ERRCODE='23514';
 END IF;
 -- Source-conditioned sodium requirement is deliberately strict for the
 -- initial eight USDA Foundation review records; future food groups need
 -- explicit versioned conditional coverage rather than caller toggles.
 SELECT array_agg(code) INTO v_missing FROM (
   SELECT unnest(ARRAY['energy_kcal','protein_g','carbohydrate_g','total_fat_g','sodium_mg']) AS code
 ) AS required
 WHERE NOT EXISTS (
   SELECT 1 FROM public.v2_ingredient_profile_nutrients pn
   WHERE pn.profile_id=p_profile_id AND pn.nutrient_code=required.code
     AND pn.amount>=0
 );
 IF v_missing IS NOT NULL THEN
   RAISE EXCEPTION 'incomplete profile nutrients: %',v_missing USING ERRCODE='23514';
 END IF;
 IF p_action='review' AND v_profile.review_status IN ('candidate','needs_review') THEN
   v_target:='reviewed';
 ELSIF p_action='publish' AND v_capability='publisher' AND
       v_profile.review_status='reviewed' AND
       EXISTS (SELECT 1 FROM allin_private.v2_ingredient_review_events e
         WHERE e.profile_id=p_profile_id AND e.action='review'
           AND e.new_status='reviewed' AND e.new_revision=p_expected_revision
           AND e.source_record_id=p_source_record_id
           AND e.source_payload_sha256=p_source_payload_sha256
           AND e.evidence_sha256=p_evidence_sha256
           AND e.energy_policy_version=p_energy_policy_version
           AND e.nutrient_set_version=p_nutrient_set_version) THEN
   -- Publication remains disabled by independent release policy until ALL-222.
   RAISE EXCEPTION 'publication disabled pending ALL-222 release approval' USING ERRCODE='42501';
 ELSE
   RAISE EXCEPTION 'disallowed review transition' USING ERRCODE='23514';
 END IF;
 UPDATE public.v2_ingredient_nutrition_profiles
 SET review_status=v_target,profile_revision=profile_revision+1,
     reviewed_at=transaction_timestamp(),updated_at=transaction_timestamp()
 WHERE id=p_profile_id AND profile_revision=p_expected_revision;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'concurrent profile review update' USING ERRCODE='40001';
 END IF;
 INSERT INTO allin_private.v2_ingredient_review_events(
 actor_user_id,action_id,ingredient_id,profile_id,source_record_id,action,
 prior_status,new_status,prior_revision,new_revision,evidence_sha256,
 source_payload_sha256,energy_policy_version,nutrient_set_version)
 VALUES (p_actor_id,p_action_id,v_profile.ingredient_id,p_profile_id,
   p_source_record_id,p_action,v_profile.review_status,v_target,
   p_expected_revision,p_expected_revision+1,p_evidence_sha256,
   p_source_payload_sha256,p_energy_policy_version,p_nutrient_set_version);
 RETURN jsonb_build_object('status','reviewed','profile_id',p_profile_id,
   'revision',p_expected_revision+1,'review_status',v_target);
END $$;

REVOKE ALL ON FUNCTION allin_private.v2_ingredient_review_profile(
 uuid,uuid,uuid,integer,uuid,text,text,text,text,text)
 FROM PUBLIC, anon, authenticated, service_role;
-- Deliberately no GRANT EXECUTE and no grant of private schema USAGE to
-- reviewer executor until ALL-222 approves the operator-auth gateway.
-- Deliberately no GRANT of table writes to the executor role.
COMMIT;
