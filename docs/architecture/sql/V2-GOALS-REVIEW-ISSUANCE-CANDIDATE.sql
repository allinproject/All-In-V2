-- ALL-239 REVIEW ONLY — trusted explicit Goal review issuance.
-- Requires canonical Goal identity, behavior, writer, and durable review SQL.
-- No grant; future UI must show the exact approved preview and verify intent.
CREATE FUNCTION allin_private.v2_goal_issue_review_candidate(
 p_user_id uuid,p_session_id uuid,p_goal_id uuid,p_revision_id uuid,
 p_review_id uuid,p_action_id uuid,p_expected_version bigint,
 p_reviewed_sha256 text,p_athlete_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $issue$
DECLARE
 digest text;
 approved allin_private.v2_goal_approval_reviews%ROWTYPE;
 v_review_clock timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF pg_catalog.current_setting('role',true) NOT IN
   ('service_role','postgres','none') THEN
   RAISE EXCEPTION 'Trusted Goal review issuer required' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_goal_id IS NULL
 OR p_revision_id IS NULL OR p_review_id IS NULL OR p_action_id IS NULL
 OR p_expected_version IS NULL OR p_expected_version<1
 OR p_reviewed_sha256 IS NULL OR p_reviewed_sha256 !~ '^[0-9a-f]{64}$'
 OR p_athlete_confirmed IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Explicit reviewed Goal confirmation required'
   USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.sessions s
  WHERE s.id=p_session_id AND s.user_id=p_user_id
    AND (s.not_after IS NULL OR s.not_after>v_review_clock)
  FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(
   SELECT 1 FROM auth.users WHERE id=p_user_id
 ) THEN RAISE EXCEPTION 'Live Goal confirmation session required'
   USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.v2_goals
  WHERE id=p_goal_id AND user_id=p_user_id
    AND version=p_expected_version
    AND status IN ('draft','active','paused')
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Goal preview changed'
   USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.v2_goal_revisions
  WHERE id=p_revision_id AND goal_id=p_goal_id
    AND user_id=p_user_id AND status='candidate'
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Goal candidate no longer editable'
   USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.v2_goal_revision_behavior_targets
  WHERE goal_revision_id=p_revision_id AND goal_id=p_goal_id
    AND user_id=p_user_id FOR SHARE;
 IF EXISTS(
  SELECT 1 FROM public.v2_goal_revision_behavior_targets
  WHERE goal_revision_id=p_revision_id AND goal_id=p_goal_id
    AND user_id=p_user_id AND user_confirmed IS NOT TRUE
 ) THEN RAISE EXCEPTION 'Unconfirmed behavior cannot be approved'
   USING ERRCODE='42501'; END IF;
 digest:=allin_private.v2_goal_snapshot_fingerprint_candidate(
  p_user_id,p_goal_id,p_revision_id,p_expected_version);
 IF digest IS DISTINCT FROM p_reviewed_sha256 THEN
  RAISE EXCEPTION 'Displayed Goal preview no longer matches'
    USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_goal_approval_reviews(
  id,user_id,session_id,goal_id,goal_revision_id,action_id,
  expected_version,payload_sha256,athlete_confirmed,approved_at,expires_at
 ) VALUES(
  p_review_id,p_user_id,p_session_id,p_goal_id,p_revision_id,p_action_id,
  p_expected_version,digest,true,v_review_clock,v_review_clock+interval '10 minutes'
 ) ON CONFLICT(user_id,id) DO NOTHING;
 SELECT * INTO approved FROM allin_private.v2_goal_approval_reviews
  WHERE user_id=p_user_id AND id=p_review_id FOR UPDATE;
 IF NOT FOUND OR approved.session_id IS DISTINCT FROM p_session_id
 OR approved.goal_id IS DISTINCT FROM p_goal_id
 OR approved.goal_revision_id IS DISTINCT FROM p_revision_id
 OR approved.action_id IS DISTINCT FROM p_action_id
 OR approved.expected_version IS DISTINCT FROM p_expected_version
 OR approved.payload_sha256 IS DISTINCT FROM digest
 OR approved.athlete_confirmed IS DISTINCT FROM true
 OR approved.expires_at<=v_review_clock THEN
  RAISE EXCEPTION 'Review action key reused or expired'
   USING ERRCODE='23505';
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_user_id,'sessionId',p_session_id,
  'goalId',p_goal_id,'revisionId',p_revision_id,
  'actionId',p_action_id,'reviewId',p_review_id,
  'expectedVersion',p_expected_version,
  'sha256',digest,'approved',true,'cancelled',false,
  'expiresAt',approved.expires_at);
END;
$issue$;
REVOKE ALL ON FUNCTION allin_private.v2_goal_issue_review_candidate(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
