-- ALL-244 / ALL-251 / ALL-222 — REVIEW-ONLY privacy visibility owner candidate.
-- NOT A SUPABASE MIGRATION. Never enable API EXECUTE without independent
-- review, session/account checks and deployed cross-user authorization tests.
-- The canonical identity is public.v2_profiles; no shadow profile table.
-- Relationship writer locks this SAME visibility row after its pair lock.
-- This owner writer uses only the visibility row, never pair rows, avoiding
-- a visibility -> pair inverse-lock cycle.

CREATE OR REPLACE FUNCTION public.v2_community_my_visibility_read()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $visibility_read$
DECLARE
  v_actor uuid := auth.uid();
  v_value text;
  v_version bigint;
BEGIN
  IF v_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = v_actor)
  THEN
    RAISE EXCEPTION 'community_visibility_account_unavailable'
      USING ERRCODE = '42501';
  END IF;
  SELECT profile_visibility, version INTO v_value, v_version
  FROM allin_private.v2_community_visibility WHERE user_id = v_actor;
  RETURN jsonb_build_object(
    'ownerId', v_actor,
    'visibility', COALESCE(v_value, 'private'),
    'version', COALESCE(v_version, 1)
  );
END;
$visibility_read$;

CREATE OR REPLACE FUNCTION public.v2_community_set_my_visibility(
  p_expected_actor_id uuid,
  p_next_visibility text,
  p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $visibility_write$
DECLARE
  v_actor uuid := auth.uid();
  v_version bigint;
  v_current text;
BEGIN
  IF v_actor IS NULL OR p_expected_actor_id IS DISTINCT FROM v_actor
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = v_actor)
  THEN
    RAISE EXCEPTION 'community_visibility_account_unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF p_next_visibility IS NULL OR
     p_next_visibility NOT IN ('public','private') OR
     p_expected_version IS NULL OR p_expected_version < 1
  THEN
    RAISE EXCEPTION 'invalid_community_visibility_intent'
      USING ERRCODE = '22023';
  END IF;

  -- Inserts serialize with other concurrent inserts for same owner.
  -- A public-follow writer also takes this row lock, so its
  -- eligibility check uses the actual privacy state in its transaction.
  INSERT INTO allin_private.v2_community_visibility(user_id)
  VALUES (v_actor) ON CONFLICT (user_id) DO NOTHING;
  SELECT profile_visibility, version INTO v_current, v_version
  FROM allin_private.v2_community_visibility
  WHERE user_id = v_actor FOR UPDATE;

  IF v_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'stale_community_visibility_revision'
      USING ERRCODE = '40001';
  END IF;
  IF v_current = p_next_visibility THEN
    -- No-op is not a write or an advancing success receipt.
    RETURN jsonb_build_object(
      'ownerId', v_actor, 'visibility', v_current,
      'version', v_version, 'changed', false
    );
  END IF;

  UPDATE allin_private.v2_community_visibility
  SET profile_visibility = p_next_visibility,
      version = v_version + 1, updated_at = now()
  WHERE user_id = v_actor;

  RETURN jsonb_build_object(
    'ownerId', v_actor,
    'visibility', p_next_visibility,
    'version', v_version + 1,
    'changed', true
  );
END;
$visibility_write$;

REVOKE ALL ON FUNCTION public.v2_community_my_visibility_read()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.v2_community_set_my_visibility(uuid,text,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
-- A private -> public switch does NOT approve pending followers or
-- automatically publish private posts. A public -> private switch
-- does NOT silently revoke existing approved followers; those remain
-- explicit athlete relationships and require independent unfollow/block.
