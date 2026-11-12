-- ALL-247 / ALL-222 REVIEW ONLY. Not a versioned migration; DO NOT deploy.
-- First narrow Fuel slice: manually reported consumed food, with NO inferred nutrients.
-- Extend this owner table later with reviewed ingredient/recipe/prepared-portion FKs.
-- Do not create a second Cookbook catalog, food-source cache or Coach diary.
BEGIN;

CREATE TABLE public.v2_fuel_food_entries_candidate (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consumed_at timestamptz NOT NULL,
  consumed_local_date date NOT NULL,
  timezone text NOT NULL CHECK (length(btrim(timezone)) BETWEEN 1 AND 80),
  meal_slot text NOT NULL CHECK (meal_slot IN
    ('breakfast','lunch','dinner','snack','other')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  quantity numeric(16,6) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  quantity_unit text NOT NULL CHECK (quantity_unit IN ('g','ml','piece','serving')),
  -- A manual text entry carries NO certified profile, serving conversion or macros.
  source_kind text NOT NULL DEFAULT 'manual_unresolved'
    CHECK (source_kind = 'manual_unresolved'),
  nutrient_coverage text NOT NULL DEFAULT 'unknown'
    CHECK (nutrient_coverage = 'unknown'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,user_id)
);
CREATE INDEX v2_fuel_food_entries_candidate_owner_day_idx
  ON public.v2_fuel_food_entries_candidate(user_id,consumed_local_date,consumed_at,id)
  WHERE deleted_at IS NULL;

CREATE TABLE allin_private.v2_fuel_food_actions_candidate (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create','correct','move','delete')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,action_id),
  FOREIGN KEY (entry_id,user_id)
    REFERENCES public.v2_fuel_food_entries_candidate(id,user_id) ON DELETE CASCADE
);
ALTER TABLE public.v2_fuel_food_entries_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_fuel_food_actions_candidate ENABLE ROW LEVEL SECURITY;
-- Default deny: this review-only slice has no exposed reader or writer grant.
REVOKE ALL ON public.v2_fuel_food_entries_candidate
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_fuel_food_actions_candidate
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_fuel_apply_manual_food_candidate(
  p_expected_user_id uuid, p_action_id uuid, p_entry_id uuid,
  p_operation text, p_expected_revision bigint,
  p_consumed_at timestamptz, p_consumed_local_date date,
  p_timezone text, p_meal_slot text, p_description text,
  p_quantity numeric, p_quantity_unit text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $writer$
DECLARE
  v_existing allin_private.v2_fuel_food_actions_candidate%ROWTYPE;
  v_entry public.v2_fuel_food_entries_candidate%ROWTYPE;
  v_hash text;
  v_revision bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) IS DISTINCT FROM p_expected_user_id THEN
    RAISE EXCEPTION 'Fuel owner authentication required' USING ERRCODE='42501';
  END IF;
  IF p_action_id IS NULL OR p_entry_id IS NULL
    OR p_operation NOT IN ('create','correct','move','delete')
    OR p_operation IS NULL THEN
    RAISE EXCEPTION 'Invalid Fuel action identity' USING ERRCODE='22023';
  END IF;
  -- Hash all typed action inputs, including the null-bearing fields.
  v_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_array(
      p_expected_user_id,p_entry_id,p_operation,p_expected_revision,
      p_consumed_at,p_consumed_local_date,p_timezone,p_meal_slot,
      p_description,p_quantity,p_quantity_unit)::text,'sha256'),'hex');
  -- pgcrypto schema placement must be verified against the target Supabase baseline
  -- before this candidate can become a migration.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('v2-fuel:' || p_expected_user_id::text,0));
  SELECT * INTO v_existing FROM allin_private.v2_fuel_food_actions_candidate
    WHERE user_id=p_expected_user_id AND action_id=p_action_id;
  IF FOUND THEN
    IF v_existing.request_hash<>v_hash OR v_existing.entry_id<>p_entry_id
      OR v_existing.operation<>p_operation THEN
      RAISE EXCEPTION 'Fuel action ID reused with changed payload' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'entryId',v_existing.entry_id,'revision',v_existing.result_revision,'replayed',true);
  END IF;
  IF p_operation='create' THEN
    IF p_expected_revision IS NOT NULL OR p_consumed_at IS NULL
      OR p_consumed_local_date IS NULL OR p_timezone IS NULL
      OR p_meal_slot IS NULL OR p_description IS NULL OR p_quantity IS NULL
      OR p_quantity_unit IS NULL THEN
      RAISE EXCEPTION 'Incomplete manual food entry' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.v2_fuel_food_entries_candidate(
      id,user_id,consumed_at,consumed_local_date,timezone,meal_slot,
      description,quantity,quantity_unit)
    VALUES(p_entry_id,p_expected_user_id,p_consumed_at,p_consumed_local_date,
      p_timezone,p_meal_slot,p_description,p_quantity,p_quantity_unit);
    v_revision:=1;
  ELSE
    SELECT * INTO v_entry FROM public.v2_fuel_food_entries_candidate
      WHERE id=p_entry_id AND user_id=p_expected_user_id FOR UPDATE;
    IF NOT FOUND OR v_entry.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Fuel entry not found or deleted' USING ERRCODE='42501';
    END IF;
    IF p_expected_revision IS NULL OR v_entry.revision<>p_expected_revision THEN
      RAISE EXCEPTION 'Stale Fuel entry revision' USING ERRCODE='40001';
    END IF;
    IF p_operation='delete' THEN
      UPDATE public.v2_fuel_food_entries_candidate SET
        deleted_at=now(),updated_at=now(),revision=revision+1
      WHERE id=p_entry_id AND user_id=p_expected_user_id;
    ELSE
      IF p_consumed_at IS NULL OR p_consumed_local_date IS NULL
        OR p_timezone IS NULL OR p_meal_slot IS NULL OR p_description IS NULL
        OR p_quantity IS NULL OR p_quantity_unit IS NULL THEN
        RAISE EXCEPTION 'Incomplete Fuel correction' USING ERRCODE='22023';
      END IF;
      IF p_operation='move' AND (p_description<>v_entry.description
          OR p_quantity<>v_entry.quantity OR p_quantity_unit<>v_entry.quantity_unit) THEN
        RAISE EXCEPTION 'Move cannot silently rewrite food identity or quantity'
          USING ERRCODE='22023';
      END IF;
      UPDATE public.v2_fuel_food_entries_candidate SET
        consumed_at=p_consumed_at,consumed_local_date=p_consumed_local_date,
        timezone=p_timezone,meal_slot=p_meal_slot,
        description=p_description,quantity=p_quantity,quantity_unit=p_quantity_unit,
        updated_at=now(),revision=revision+1
      WHERE id=p_entry_id AND user_id=p_expected_user_id;
    END IF;
    v_revision:=v_entry.revision+1;
  END IF;
  INSERT INTO allin_private.v2_fuel_food_actions_candidate(
    user_id,action_id,entry_id,operation,request_hash,result_revision)
  VALUES(p_expected_user_id,p_action_id,p_entry_id,p_operation,v_hash,v_revision);
  RETURN pg_catalog.jsonb_build_object(
    'entryId',p_entry_id,'revision',v_revision,'replayed',false);
END;
$writer$;
REVOKE ALL ON FUNCTION allin_private.v2_fuel_apply_manual_food_candidate(
  uuid,uuid,uuid,text,bigint,timestamptz,date,text,text,text,numeric,text)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

-- RELEASE GATES: function owner and pgcrypto extension schema, auth/session expiry,
-- service execution/grants, exact owner reader, timezone/date validation, quantity
-- unit semantics, custom-food/ingredient/recipe/prepared-source typed FKs, photo
-- Storage, ALL-251 export/deletion, offline/device retry, two-account RLS tests,
-- confirmed approved migration ordering and production authorization.
-- The SECURITY DEFINER is deliberately NONEXECUTABLE by client/service roles.
