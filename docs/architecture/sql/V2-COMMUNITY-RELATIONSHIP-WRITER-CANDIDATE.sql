-- ALL-244 / ALL-222: REVIEW-ONLY Community relationship writer candidate.
-- NOT A DEPLOYMENT MIGRATION. Requires the privacy owner candidate first.
-- Must pass isolated multi-session authorization and concurrency review.
-- Reports are deliberately excluded until moderation owns an intake path.
-- Auth identity is always auth.uid(), never a client-selected actor.

CREATE OR REPLACE FUNCTION public.v2_community_relationship_write(
  p_expected_actor_id uuid,
  p_target_id uuid,
  p_action text,
  p_expected_version bigint,
  p_action_id uuid,
  p_payload_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_lower uuid;
  v_upper uuid;
  v_version bigint;
  v_visibility text;
  v_blocked boolean;
  v_existing allin_private.v2_community_action_receipts%ROWTYPE;
  v_state text;
  v_result_version bigint;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL OR p_expected_actor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'not_authenticated_or_wrong_actor' USING ERRCODE = '42501';
  END IF;
  IF p_target_id IS NULL OR p_target_id = v_actor OR p_action_id IS NULL
     OR p_expected_version IS NULL OR p_expected_version < 1
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_action NOT IN ('follow', 'request_follow', 'cancel_request',
                         'unfollow', 'approve_request', 'reject_request',
                         'block', 'unblock') THEN
    RAISE EXCEPTION 'invalid_relationship_action' USING ERRCODE = '22023';
  END IF;

  -- A token for a deleted account must not execute as a live actor.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = v_actor)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_id)
     OR NOT EXISTS (SELECT 1 FROM public.v2_profiles WHERE user_id = p_target_id) THEN
    RAISE EXCEPTION 'relationship_account_unavailable' USING ERRCODE = '42501';
  END IF;

  -- Lock one ordered pair, including opposing actions, at READ COMMITTED.
  v_lower := LEAST(v_actor, p_target_id);
  v_upper := GREATEST(v_actor, p_target_id);
  INSERT INTO allin_private.v2_community_pair_revisions(lower_user_id, upper_user_id)
  VALUES (v_lower, v_upper)
  ON CONFLICT (lower_user_id, upper_user_id) DO NOTHING;

  SELECT version INTO v_version
  FROM allin_private.v2_community_pair_revisions
  WHERE lower_user_id = v_lower AND upper_user_id = v_upper
  FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'relationship_pair_missing' USING ERRCODE = 'P0001';
  END IF;

  -- Exact replay must bind actor, target, action, expected revision and
  -- immutable request fingerprint; changed retries are always rejected.
  SELECT * INTO v_existing
  FROM allin_private.v2_community_action_receipts
  WHERE actor_id = v_actor AND action_id = p_action_id;
  IF FOUND THEN
    IF v_existing.target_id IS DISTINCT FROM p_target_id
       OR v_existing.action IS DISTINCT FROM p_action
       OR v_existing.expected_version IS DISTINCT FROM p_expected_version
       OR v_existing.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
      RAISE EXCEPTION 'relationship_action_id_reused' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'actorId', v_actor, 'targetOwnerId', p_target_id,
      'actionId', p_action_id, 'action', p_action,
      'version', v_existing.result_version, 'accepted', true,
      'replayed', true
    );
  END IF;
  IF v_version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_relationship_revision' USING ERRCODE = '40001';
  END IF;

  -- Lock target visibility before reading. A visibility update must
  -- synchronize with pair transitions through its approved owner.
  INSERT INTO allin_private.v2_community_visibility(user_id)
  VALUES (p_target_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT profile_visibility INTO v_visibility
  FROM allin_private.v2_community_visibility
  WHERE user_id = p_target_id FOR UPDATE;

  SELECT EXISTS(
    SELECT 1 FROM allin_private.v2_community_blocks
    WHERE (blocker_id = v_actor AND blocked_id = p_target_id)
       OR (blocker_id = p_target_id AND blocked_id = v_actor)
  ) INTO v_blocked;

  IF p_action = 'block' THEN
    INSERT INTO allin_private.v2_community_blocks(blocker_id, blocked_id)
    VALUES(v_actor, p_target_id) ON CONFLICT DO NOTHING;
    -- A block must atomically revoke both follow directions.
    DELETE FROM allin_private.v2_community_follows
    WHERE (follower_id = v_actor AND followed_id = p_target_id)
       OR (follower_id = p_target_id AND followed_id = v_actor);
  ELSIF p_action = 'unblock' THEN
    IF NOT EXISTS (
      SELECT 1 FROM allin_private.v2_community_blocks
      WHERE blocker_id = v_actor AND blocked_id = p_target_id
    ) THEN
      RAISE EXCEPTION 'no_owned_block' USING ERRCODE = '22023';
    END IF;
    DELETE FROM allin_private.v2_community_blocks
    WHERE blocker_id = v_actor AND blocked_id = p_target_id;
  ELSE
    IF v_blocked THEN
      RAISE EXCEPTION 'blocked_relationship' USING ERRCODE = '42501';
    END IF;

    IF p_action IN ('follow', 'request_follow') THEN
      IF (p_action = 'follow' AND v_visibility <> 'public')
         OR (p_action = 'request_follow' AND v_visibility <> 'private') THEN
        RAISE EXCEPTION 'visibility_requires_other_follow_action' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1 FROM allin_private.v2_community_follows
        WHERE follower_id = v_actor AND followed_id = p_target_id
      ) THEN
        RAISE EXCEPTION 'already_following_or_requested' USING ERRCODE = '22023';
      END IF;
      INSERT INTO allin_private.v2_community_follows(
        follower_id, followed_id, state, approved_at
      ) VALUES(
        v_actor, p_target_id,
        CASE WHEN p_action = 'follow' THEN 'approved' ELSE 'pending' END,
        CASE WHEN p_action = 'follow' THEN now() ELSE NULL END
      );
    ELSIF p_action = 'cancel_request' THEN
      DELETE FROM allin_private.v2_community_follows
      WHERE follower_id = v_actor AND followed_id = p_target_id
        AND state = 'pending';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_owned_pending_request' USING ERRCODE = '22023';
      END IF;
    ELSIF p_action = 'unfollow' THEN
      DELETE FROM allin_private.v2_community_follows
      WHERE follower_id = v_actor AND followed_id = p_target_id
        AND state = 'approved';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_owned_follow' USING ERRCODE = '22023';
      END IF;
    ELSIF p_action IN ('approve_request', 'reject_request') THEN
      -- The current actor is the recipient and only owns inbound requests.
      SELECT state INTO v_state
      FROM allin_private.v2_community_follows
      WHERE follower_id = p_target_id AND followed_id = v_actor
      FOR UPDATE;
      IF v_state IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'no_incoming_request' USING ERRCODE = '42501';
      END IF;
      IF p_action = 'approve_request' THEN
        UPDATE allin_private.v2_community_follows
          SET state = 'approved', approved_at = now(), updated_at = now()
        WHERE follower_id = p_target_id AND followed_id = v_actor;
      ELSE
        DELETE FROM allin_private.v2_community_follows
        WHERE follower_id = p_target_id AND followed_id = v_actor;
      END IF;
    END IF;
  END IF;

  v_result_version := v_version + 1;
  UPDATE allin_private.v2_community_pair_revisions
    SET version = v_result_version, updated_at = now()
  WHERE lower_user_id = v_lower AND upper_user_id = v_upper;

  INSERT INTO allin_private.v2_community_action_receipts(
    actor_id, action_id, target_id, action, expected_version,
    result_version, payload_sha256
  ) VALUES (
    v_actor, p_action_id, p_target_id, p_action, v_version,
    v_result_version, p_payload_sha256
  );

  RETURN jsonb_build_object(
    'actorId', v_actor, 'targetOwnerId', p_target_id,
    'actionId', p_action_id, 'action', p_action,
    'version', v_result_version, 'accepted', true,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.v2_community_relationship_write(
  uuid,uuid,text,bigint,uuid,text
) FROM PUBLIC, anon, authenticated, service_role;
-- Before deployment the owner must explicitly approve authenticated EXECUTE,
-- install API session guards and evaluate the SECURITY DEFINER threat model.
-- No callable user-facing endpoint is enabled by this candidate.
