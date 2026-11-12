-- ALL-239 / ALL-222 review-only: service-bound atomic Goal revision acceptance.
-- NOT A MIGRATION, NOT A DEPLOYMENT, NO CLIENT WRITER GRANTS.
-- Caller must be a separately authenticated/authorized trusted server adapter.
-- Apply AFTER Goal identity and published-history guard candidates.
BEGIN;

CREATE TABLE allin_private.v2_goal_acceptance_actions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Do not cascade with auth.sessions: receipts must survive session revocation.
  session_id uuid NOT NULL,
  action_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  candidate_revision_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  result_version bigint NOT NULL CHECK(result_version>=2),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,action_id),
  FOREIGN KEY(goal_id,user_id) REFERENCES public.v2_goals(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(candidate_revision_id,goal_id,user_id)
    REFERENCES public.v2_goal_revisions(id,goal_id,user_id)
);
ALTER TABLE allin_private.v2_goal_acceptance_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_goal_acceptance_actions
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_goal_accept_revision_candidate(
 p_user_id uuid,p_session_id uuid,p_goal_id uuid,p_candidate_id uuid,
 p_action_id uuid,p_expected_version bigint,p_payload_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $accept$
DECLARE
 g public.v2_goals%ROWTYPE;
 rev public.v2_goal_revisions%ROWTYPE;
 previous public.v2_goal_revisions%ROWTYPE;
 prior allin_private.v2_goal_acceptance_actions%ROWTYPE;
 new_version bigint;
BEGIN
 -- Trusted service only. No public/authenticated/anon RPC or owner override.
 IF current_setting('role',true) NOT IN ('service_role','postgres','none') THEN
   RAISE EXCEPTION 'Service authorization required' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_goal_id IS NULL OR p_candidate_id IS NULL
    OR p_action_id IS NULL OR p_expected_version IS NULL
    OR p_expected_version<1 OR p_payload_sha256 IS NULL
    OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Invalid Goal acceptance action' USING ERRCODE='22023';
 END IF;
 -- Ensure the owner still exists before even reading replay receipts.
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
   RAISE EXCEPTION 'Goal owner no longer exists' USING ERRCODE='42501';
 END IF;
 -- Lock the live Auth session for the lifetime of the acceptance transaction.
 -- Concurrent revocation/deletion must serialize with this approval; a
 -- removed or expired session cannot replay a previously accepted action.
 PERFORM 1 FROM auth.sessions s
  WHERE s.id=p_session_id AND s.user_id=p_user_id
    AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())
  FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Current Goal approval session required' USING ERRCODE='42501';
 END IF;
 -- Lock canonical goal BEFORE examining receipt: serializes competing actions.
 SELECT * INTO g FROM public.v2_goals
  WHERE id=p_goal_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Goal not found for authenticated owner' USING ERRCODE='42501';
 END IF;
 SELECT * INTO prior FROM allin_private.v2_goal_acceptance_actions
  WHERE user_id=p_user_id AND action_id=p_action_id;
 IF FOUND THEN
   IF prior.session_id<>p_session_id OR prior.goal_id<>p_goal_id OR prior.candidate_revision_id<>p_candidate_id
      OR prior.payload_sha256<>p_payload_sha256
      OR prior.result_version<>p_expected_version+1 THEN
     RAISE EXCEPTION 'Goal action key reused with different payload or version'
       USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object(
     'goalId',prior.goal_id,'revisionId',prior.candidate_revision_id,
     'version',prior.result_version,'replayed',true);
 END IF;
 IF g.version<>p_expected_version OR g.status NOT IN ('draft','active','paused') THEN
   RAISE EXCEPTION 'Goal version or lifecycle changed' USING ERRCODE='40001';
 END IF;
 SELECT * INTO rev FROM public.v2_goal_revisions
  WHERE id=p_candidate_id AND goal_id=p_goal_id AND user_id=p_user_id
  FOR UPDATE;
 IF NOT FOUND OR rev.status<>'candidate' THEN
   RAISE EXCEPTION 'Goal revision is not an editable candidate'
     USING ERRCODE='40001';
 END IF;
 IF g.active_revision_id IS NULL THEN
   IF rev.revision_number<>1 THEN
     RAISE EXCEPTION 'Initial Goal revision number must be one'
       USING ERRCODE='22023';
   END IF;
 ELSE
   SELECT * INTO previous FROM public.v2_goal_revisions
    WHERE id=g.active_revision_id AND goal_id=g.id AND user_id=g.user_id
    FOR UPDATE;
   IF NOT FOUND OR previous.status<>'accepted'
      OR rev.revision_number<>previous.revision_number+1 THEN
     RAISE EXCEPTION 'Goal active revision or sequence changed'
       USING ERRCODE='40001';
   END IF;
   UPDATE public.v2_goal_revisions SET status='superseded'
    WHERE id=previous.id AND user_id=p_user_id;
 END IF;
 UPDATE public.v2_goal_revisions
  SET status='accepted',accepted_at=pg_catalog.clock_timestamp()
  WHERE id=rev.id AND goal_id=p_goal_id AND user_id=p_user_id;
 new_version:=g.version+1;
 UPDATE public.v2_goals
  SET active_revision_id=rev.id,version=new_version,updated_at=pg_catalog.clock_timestamp()
  WHERE id=g.id AND user_id=p_user_id AND version=p_expected_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Goal concurrent mutation detected' USING ERRCODE='40001'; END IF;
 INSERT INTO allin_private.v2_goal_acceptance_actions(
   user_id,session_id,action_id,goal_id,candidate_revision_id,payload_sha256,result_version
 ) VALUES(p_user_id,p_session_id,p_action_id,p_goal_id,p_candidate_id,p_payload_sha256,new_version);
 RETURN pg_catalog.jsonb_build_object(
   'goalId',p_goal_id,'revisionId',p_candidate_id,'version',new_version,'replayed',false);
END;
$accept$;
REVOKE ALL ON FUNCTION allin_private.v2_goal_accept_revision_candidate(
 uuid,uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
-- Private, non-PostgREST owner routine. A later reviewed server-only
-- public gateway may delegate after validating the live Auth session and
-- exact athlete-approved Goal preview; no such gateway is deployed here.
-- No service_role grant. Local tests call as disposable DDL owner.
COMMIT;
