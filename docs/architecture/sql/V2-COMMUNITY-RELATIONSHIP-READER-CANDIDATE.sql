-- ALL-244: REVIEW-ONLY current Community relationship reader.
-- NOT DEPLOYED. No direct grants; requires canonical privacy tables.
-- One SQL statement gives a coherent READ COMMITTED snapshot. The writer's
-- versioned pair CAS is the final authority for all follow/block mutations.
-- Never return target profile display name, optional location, posts or events.

CREATE OR REPLACE FUNCTION public.v2_community_relationship_read(
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = v_actor) THEN
    RAISE EXCEPTION 'community_reader_requires_active_account'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_id IS NULL OR p_target_id = v_actor
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_id)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = p_target_id) THEN
    RAISE EXCEPTION 'community_target_unavailable' USING ERRCODE = '42501';
  END IF;

  WITH relationship_evidence AS (
    SELECT
      COALESCE(visibility.profile_visibility, 'private') AS profile_visibility,
      COALESCE(pair.version, 1) AS pair_version,
      EXISTS (
        SELECT 1 FROM allin_private.v2_community_blocks
        WHERE blocker_id = v_actor AND blocked_id = p_target_id
      ) AS actor_blocked_target,
      EXISTS (
        SELECT 1 FROM allin_private.v2_community_blocks
        WHERE blocker_id = p_target_id AND blocked_id = v_actor
      ) AS target_blocked_actor,
      (
        SELECT f.state FROM allin_private.v2_community_follows AS f
        WHERE f.follower_id = v_actor AND f.followed_id = p_target_id
      ) AS outbound_follow,
      EXISTS (
        SELECT 1 FROM allin_private.v2_community_follows AS f
        WHERE f.follower_id = p_target_id
          AND f.followed_id = v_actor
          AND f.state = 'pending'
      ) AS inbound_pending
    FROM (SELECT 1) AS anchor
    LEFT JOIN allin_private.v2_community_visibility AS visibility
      ON visibility.user_id = p_target_id
    LEFT JOIN allin_private.v2_community_pair_revisions AS pair
      ON pair.lower_user_id = LEAST(v_actor, p_target_id)
     AND pair.upper_user_id = GREATEST(v_actor, p_target_id)
  )
  SELECT jsonb_build_object(
    'viewerId', v_actor,
    'targetOwnerId', p_target_id,
    'version', pair_version,
    'targetVisibility', CASE
      WHEN actor_blocked_target OR target_blocked_actor
        THEN 'private'
      ELSE profile_visibility
    END,
    'relationship', CASE
      WHEN actor_blocked_target OR target_blocked_actor
        THEN 'blocked_either_way'
      WHEN outbound_follow = 'approved' THEN 'approved_follower'
      WHEN outbound_follow = 'pending' THEN 'follow_requested'
      ELSE 'not_following'
    END,
    'viewerBlockedTarget', actor_blocked_target,
    'incomingRequestFromTarget', CASE
      WHEN actor_blocked_target OR target_blocked_actor
        THEN false
      ELSE inbound_pending
    END
  ) INTO v_result
  FROM relationship_evidence;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'community_relationship_snapshot_missing'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.v2_community_relationship_read(uuid)
FROM PUBLIC, anon, authenticated, service_role;
-- Final review must approve EXECUTE only for authenticated + scoped session
-- guard and consistent public profile read and mutation re-read contracts.
