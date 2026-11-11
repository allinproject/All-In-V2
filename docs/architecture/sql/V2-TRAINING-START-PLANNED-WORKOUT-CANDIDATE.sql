-- ALL-246 REVIEW ONLY: exact accepted Training session -> canonical execution.
-- NOT A MIGRATION, NO app grants. This extends existing plan/session writers;
-- it never creates a second execution/Completed Activity store.
CREATE FUNCTION allin_private.v2_training_start_scheduled_candidate(
 p_owner_id uuid,p_execution_id uuid,p_revision_session_id uuid,p_action_id uuid,
 p_expected_plan_version bigint,p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $scheduled$
DECLARE
 v_slot public.v2_training_revision_sessions%ROWTYPE;
 v_plan public.v2_training_plans%ROWTYPE;
 v_receipt allin_private.v2_training_action_receipts%ROWTYPE;
 v_existing public.v2_training_session_instances%ROWTYPE;
 v_hash text;
 v_reply jsonb;
BEGIN
 IF p_owner_id IS NULL OR p_execution_id IS NULL OR
   p_revision_session_id IS NULL OR p_action_id IS NULL OR
   p_expected_plan_version IS NULL OR p_expected_plan_version<1 OR
   p_occurred_at IS NULL THEN
  RAISE EXCEPTION 'Invalid planned-session start' USING ERRCODE='22023'; END IF;
 -- Same ordering as plan acceptance: lock the owner's plan revision authority
 -- before reading the accepted plan, then lifecycle writer takes session lock.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-plan:'||p_owner_id::text,0));
 SELECT * INTO v_slot FROM public.v2_training_revision_sessions
   WHERE id=p_revision_session_id AND user_id=p_owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scheduled workout not owned by athlete'
   USING ERRCODE='42501'; END IF;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
   pg_catalog.jsonb_build_array(
      p_execution_id,p_revision_session_id,p_action_id,p_expected_plan_version,
      p_occurred_at)::text,'UTF8')),'hex');
 -- An exact start retry is still valid after an athlete later accepts a
 -- different plan revision. Do not rewrite the original prescription.
 SELECT * INTO v_receipt FROM allin_private.v2_training_action_receipts
   WHERE user_id=p_owner_id AND action_id=p_action_id;
 IF FOUND THEN
   SELECT * INTO v_existing FROM public.v2_training_session_instances
    WHERE id=p_execution_id AND user_id=p_owner_id;
   IF v_receipt.session_id<>p_execution_id OR v_receipt.command<>'start'
      OR v_receipt.request_fingerprint<>v_hash OR
      v_existing.revision_session_id IS DISTINCT FROM p_revision_session_id THEN
     RAISE EXCEPTION 'Conflicting scheduled start replay' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object(
     'sessionId',p_execution_id,'revisionSessionId',p_revision_session_id,
     'version',v_receipt.result_version,'replayed',true);
 END IF;
 SELECT * INTO v_plan FROM public.v2_training_plans
   WHERE id=v_slot.plan_id AND user_id=p_owner_id FOR SHARE;
 IF NOT FOUND OR v_plan.status<>'active' OR
    v_plan.active_revision_id IS DISTINCT FROM v_slot.plan_revision_id
    OR v_plan.version<>p_expected_plan_version THEN
   RAISE EXCEPTION 'Training plan changed before planned workout start'
      USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_training_plan_revisions r
    WHERE r.id=v_slot.plan_revision_id AND r.plan_id=v_slot.plan_id
     AND r.user_id=p_owner_id AND r.status='accepted') THEN
   RAISE EXCEPTION 'Only an accepted prescription may start'
      USING ERRCODE='42501'; END IF;
 v_reply:=allin_private.v2_training_apply_session_candidate(
   p_owner_id,p_execution_id,p_action_id,'start',0,v_hash,
   v_slot.athlete_local_date,v_slot.timezone,p_occurred_at);
 UPDATE public.v2_training_session_instances
  SET revision_session_id=p_revision_session_id
  WHERE id=p_execution_id AND user_id=p_owner_id;
 RETURN pg_catalog.jsonb_build_object(
   'sessionId',p_execution_id,'revisionSessionId',p_revision_session_id,
   'version',v_reply->'version','replayed',false);
END;
$scheduled$;
REVOKE ALL ON FUNCTION allin_private.v2_training_start_scheduled_candidate(
 uuid,uuid,uuid,uuid,bigint,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
-- Approved public auth gateway must eventually bind expected owner to
-- auth.uid() and require a current real session. This helper is service-only.
