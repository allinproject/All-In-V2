-- ALL-243 / ALL-246 REVIEW ONLY: service-owned canonical activity handoff.
-- NOT A MIGRATION. No client privileges. This is a candidate trusted worker,
-- NOT a raw device-data verifier, and it does not claim public deployment.
-- A finished Training session creates one needs_review Activity, never a
-- synthetic completed/verified workout or any fabricated metrics.
CREATE FUNCTION allin_private.v2_training_create_activity_from_outbox_candidate(
 p_user_id uuid,p_session_id uuid,p_activity_id uuid,p_sport text,
 p_activity_kind text,p_capture_kind text,p_source_id uuid,
 p_source_provider text,p_source_kind text,p_source_record_id text,
 p_source_quality text,p_source_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $handoff$
DECLARE
 v_outbox allin_private.v2_training_completion_outbox%ROWTYPE;
 v_session public.v2_training_session_instances%ROWTYPE;
 v_activity public.v2_completed_activities%ROWTYPE;
 v_source jsonb;
 v_planned_sport text;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_activity_id IS NULL OR
    p_sport IS NULL OR p_activity_kind IS NULL OR p_capture_kind IS NULL
 THEN RAISE EXCEPTION 'Invalid completed activity handoff' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-completion:'||p_user_id::text,0));
 SELECT * INTO v_outbox FROM allin_private.v2_training_completion_outbox
  WHERE session_instance_id=p_session_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR v_outbox.status NOT IN ('pending','processing','failed','delivered') THEN
   RAISE EXCEPTION 'Missing canonical completion handoff' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_session FROM public.v2_training_session_instances
  WHERE id=p_session_id AND user_id=p_user_id AND status='completed' FOR UPDATE;
 IF NOT FOUND OR v_session.finished_at IS NULL THEN
   RAISE EXCEPTION 'Training session not finished' USING ERRCODE='22023'; END IF;
 -- The accepted plan owns the scheduled sport. A completion dispatcher must
 -- not relabel a planned ride as a run or strength session, even if it has
 -- otherwise supplied valid source provenance. This is checked on replay too.
 IF v_session.revision_session_id IS NOT NULL THEN
   SELECT sport INTO v_planned_sport
   FROM public.v2_training_revision_sessions
   WHERE id=v_session.revision_session_id AND user_id=p_user_id;
   IF v_planned_sport IS NULL OR v_planned_sport IS DISTINCT FROM p_sport THEN
     RAISE EXCEPTION 'Completed Activity sport differs from scheduled workout'
       USING ERRCODE='22023';
   END IF;
 END IF;
 SELECT * INTO v_activity FROM public.v2_completed_activities
  WHERE training_session_instance_id=p_session_id AND user_id=p_user_id FOR UPDATE;
 IF FOUND THEN
   IF v_activity.id<>p_activity_id OR v_activity.sport<>p_sport OR
      v_activity.activity_kind<>p_activity_kind OR
      v_activity.capture_kind<>p_capture_kind THEN
     RAISE EXCEPTION 'Conflicting canonical completion replay' USING ERRCODE='23505'; END IF;
 ELSE
   INSERT INTO public.v2_completed_activities(
      id,user_id,sport,activity_kind,started_at,finished_at,
      athlete_local_date,timezone,capture_kind,status,training_session_instance_id)
   VALUES(p_activity_id,p_user_id,p_sport,p_activity_kind,v_session.started_at,
     v_session.finished_at,v_session.athlete_local_date,v_session.timezone,
     p_capture_kind,'needs_review',p_session_id);
 END IF;
 -- The attached source is provenance, NOT certification of HR, GPS, power,
 -- time coverage, nor permission for global competition ranking.
 v_source:=allin_private.v2_activity_attach_source_candidate(
   p_user_id,p_activity_id,p_source_id,p_source_provider,p_source_kind,
   p_source_record_id,p_source_quality,p_source_hash,v_session.finished_at);
 RETURN pg_catalog.jsonb_build_object('activityId',p_activity_id,
   'sessionId',p_session_id,'status','needs_review',
   'sourceReplay',v_source->'replayed');
END;
$handoff$;
REVOKE ALL ON FUNCTION allin_private.v2_training_create_activity_from_outbox_candidate(
 uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
-- Strict requirement before live use: trusted app/source dispatcher checks
-- actual source/event continuity and derives source identity; never let an
-- athlete self-attest p_source_quality/p_sport/p_capture_kind for ranking.
