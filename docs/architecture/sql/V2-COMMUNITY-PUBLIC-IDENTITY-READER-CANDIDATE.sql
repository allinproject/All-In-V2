-- ALL-244 / ALL-251: REVIEW-ONLY Community Public Profile identity reader.
-- NOT DEPLOYED; no API grants. Reuses the existing V2 auth/profile identity.
-- This is NOT the complete Public Profile reader: no posts, event memberships,
-- social media, avatar URL signing or owner-controlled general area are exposed.
-- A client MUST NOT treat 'contentReady=false' as a complete public profile.

CREATE OR REPLACE FUNCTION public.v2_community_public_identity_read(
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $identity_read$
DECLARE
  v_actor uuid := auth.uid();
  v_relationship jsonb;
  v_blocked boolean;
  v_name text;
  v_visibility text;
BEGIN
  IF v_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = v_actor)
  THEN
    RAISE EXCEPTION 'community_identity_requires_active_account'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_id IS NULL OR p_target_id = v_actor
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_id)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = p_target_id)
  THEN
    RAISE EXCEPTION 'community_identity_target_unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Existing canonical relationship reader resolves both block directions,
  -- approved-follow evidence and the pair CAS version on the server.
  v_relationship := public.v2_community_relationship_read(p_target_id);
  v_blocked := v_relationship->>'relationship' = 'blocked_either_way';

  IF NOT v_blocked THEN
    SELECT CASE
      WHEN display_name IS NOT NULL AND length(btrim(display_name)) BETWEEN 1 AND 80
      THEN btrim(display_name) ELSE NULL END
    INTO v_name FROM public.v2_profiles WHERE user_id = p_target_id;
  END IF;
  v_visibility := CASE WHEN v_blocked THEN 'private'
    ELSE v_relationship->>'targetVisibility' END;

  RETURN jsonb_build_object(
    'ownerId', p_target_id,
    'viewerId', v_actor,
    'displayName', CASE WHEN v_blocked THEN NULL ELSE v_name END,
    'profileVisibility', v_visibility,
    'relationship', v_relationship->>'relationship',
    'relationshipVersion', (v_relationship->>'version')::bigint,
    'blocked', v_blocked,
    'sharedArea', NULL,
    'shareGeneralArea', false,
    'avatarPath', NULL,
    'contentReady', false
  );
END;
$identity_read$;

REVOKE ALL ON FUNCTION public.v2_community_public_identity_read(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- A complete Public Profile must only be exposed after a separate post/event
-- ACL owner reader returns already filtered records, no over-fetched bytes,
-- correct anonymous/blocked behavior and authenticated device acceptance.
