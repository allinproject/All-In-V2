-- ALL-243 / ALL-246 REVIEW-ONLY private completion handoff acknowledgement.
-- Not a migration or deployed reader/writer. Canonical Completed Activity must
-- already exist; this never creates a synthetic activity or sensor data.
-- Future trusted worker must authenticate its own service credential and
-- reconcile sources before calling. No direct user/client privilege.
CREATE FUNCTION allin_private.v2_training_acknowledge_completion_candidate(
 p_user_id uuid,p_session_id uuid,p_completed_activity_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $ack$
DECLARE
 v_outbox allin_private.v2_training_completion_outbox%ROWTYPE;
 v_activity public.v2_completed_activities%ROWTYPE;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_completed_activity_id IS NULL THEN
   RAISE EXCEPTION 'Invalid completion acknowledgement' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_outbox FROM allin_private.v2_training_completion_outbox
  WHERE session_instance_id=p_session_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'No owner-matched completion handoff' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_activity FROM public.v2_completed_activities
  WHERE id=p_completed_activity_id AND user_id=p_user_id
    AND training_session_instance_id=p_session_id
    AND status='completed' FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Canonical activity not committed or owner mismatch'
    USING ERRCODE='42501';
 END IF;
 IF v_outbox.status='delivered' THEN
   RETURN pg_catalog.jsonb_build_object('status','delivered',
      'activityId',p_completed_activity_id,'replayed',true);
 END IF;
 IF v_outbox.status NOT IN ('pending','processing','failed') THEN
   RAISE EXCEPTION 'Unsupported handoff state' USING ERRCODE='22023';
 END IF;
 UPDATE allin_private.v2_training_completion_outbox
   SET status='delivered',delivered_at=now()
   WHERE session_instance_id=p_session_id AND user_id=p_user_id;
 RETURN pg_catalog.jsonb_build_object('status','delivered',
    'activityId',p_completed_activity_id,'replayed',false);
END;
$ack$;
REVOKE ALL ON FUNCTION allin_private.v2_training_acknowledge_completion_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
