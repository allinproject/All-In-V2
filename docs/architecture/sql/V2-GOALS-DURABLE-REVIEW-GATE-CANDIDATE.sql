-- ALL-239 / ALL-222: REVIEW-ONLY durable Goal approval, NOT A MIGRATION.
-- Apply after identity, history and v2_goal_accept_revision_candidate.
-- No client/service_role grants. No API endpoint. Trusted issuance of review
-- rows is NOT implemented: pending verified screen consent + server adapter.
BEGIN;
CREATE TABLE allin_private.v2_goal_approval_reviews (
 id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 goal_id uuid NOT NULL,
 goal_revision_id uuid NOT NULL,
 action_id uuid NOT NULL,
 expected_version bigint NOT NULL CHECK(expected_version>=1),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 athlete_confirmed boolean NOT NULL CHECK(athlete_confirmed IS TRUE),
 approved_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 completed_at timestamptz,
 PRIMARY KEY(user_id,id),
 UNIQUE(user_id,action_id),
 FOREIGN KEY(goal_id,user_id) REFERENCES public.v2_goals(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(goal_revision_id,goal_id,user_id)
  REFERENCES public.v2_goal_revisions(id,goal_id,user_id),
 CONSTRAINT v2_goal_review_finite_lifetime CHECK(
  expires_at>approved_at AND
  expires_at<=approved_at+interval '15 minutes')
);
ALTER TABLE allin_private.v2_goal_approval_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_goal_approval_reviews
 FROM PUBLIC,anon,authenticated,service_role;

-- Prevent later silent edits to reviewed identity, fingerprint, expiry or
-- athlete confirmation. Only the successful gateway may mark completion.
CREATE FUNCTION allin_private.v2_goal_approval_review_immutable_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $immutable$
BEGIN
 IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN
     RAISE EXCEPTION 'Approved Goal review may not be deleted'
       USING ERRCODE='42501';
   END IF;
   RETURN OLD;
 END IF;
 IF pg_catalog.to_jsonb(NEW)-'completed_at'
      IS DISTINCT FROM pg_catalog.to_jsonb(OLD)-'completed_at'
   OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
 THEN RAISE EXCEPTION 'Goal review identity and approval are immutable'
   USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$immutable$;
CREATE TRIGGER v2_goal_review_immutable_guard
 BEFORE UPDATE OR DELETE ON allin_private.v2_goal_approval_reviews
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_goal_approval_review_immutable_candidate();

CREATE FUNCTION allin_private.v2_goal_commit_reviewed_candidate(
 p_user_id uuid,p_session_id uuid,p_goal_id uuid,p_candidate_id uuid,
 p_action_id uuid,p_review_id uuid,p_expected_version bigint,
 p_payload_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $reviewed$
DECLARE
 approval allin_private.v2_goal_approval_reviews%ROWTYPE;
 receipt jsonb;
BEGIN
 IF pg_catalog.current_setting('role',true) NOT IN
   ('service_role','postgres','none') THEN
   RAISE EXCEPTION 'Trusted Goal reviewer required' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_goal_id IS NULL
 OR p_candidate_id IS NULL OR p_action_id IS NULL OR p_review_id IS NULL
 OR p_expected_version IS NULL OR p_expected_version<1
 OR p_payload_sha256 IS NULL
 OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Malformed Goal review' USING ERRCODE='22023'; END IF;
 -- Lock a real session; revoked/deleted sessions cannot authorize a
 -- previously approved action or its retry.
 PERFORM 1 FROM auth.sessions s
  WHERE s.id=p_session_id AND s.user_id=p_user_id
    AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())
  FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Active Goal review session required'
     USING ERRCODE='42501';
 END IF;
 SELECT * INTO approval FROM allin_private.v2_goal_approval_reviews
  WHERE user_id=p_user_id AND id=p_review_id FOR UPDATE;
 IF NOT FOUND OR approval.athlete_confirmed IS NOT TRUE
 OR approval.session_id IS DISTINCT FROM p_session_id
 OR approval.goal_id IS DISTINCT FROM p_goal_id
 OR approval.goal_revision_id IS DISTINCT FROM p_candidate_id
 OR approval.action_id IS DISTINCT FROM p_action_id
 OR approval.expected_version IS DISTINCT FROM p_expected_version
 OR approval.payload_sha256 IS DISTINCT FROM p_payload_sha256
 OR approval.approved_at>pg_catalog.clock_timestamp()
 OR approval.expires_at<=pg_catalog.clock_timestamp()
 THEN RAISE EXCEPTION 'Goal review is missing, stale or not approved'
   USING ERRCODE='42501'; END IF;
 receipt:=allin_private.v2_goal_accept_revision_candidate(
   p_user_id,p_session_id,p_goal_id,p_candidate_id,
   p_action_id,p_expected_version,approval.payload_sha256);
 UPDATE allin_private.v2_goal_approval_reviews
 SET completed_at=coalesce(completed_at,pg_catalog.clock_timestamp())
 WHERE user_id=p_user_id AND id=p_review_id;
 RETURN receipt;
END;
$reviewed$;
REVOKE ALL ON FUNCTION allin_private.v2_goal_commit_reviewed_candidate(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION allin_private.v2_goal_approval_review_immutable_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
