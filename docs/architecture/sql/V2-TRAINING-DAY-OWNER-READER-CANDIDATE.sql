-- ALL-246 / ALL-222 REVIEW ONLY: authenticated owner-scoped Training day reader.
-- NOT A MIGRATION; NO client EXECUTE permission approved.
-- Reads the canonical accepted revisions and canonical session instances.
-- Supports multiple active plans/events; never silently selects only one race.
-- An already-started workout remains visible even if its plan is superseded.
CREATE FUNCTION public.v2_training_day_read_candidate(
 p_expected_user_id uuid, p_athlete_date date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $read$
DECLARE
 v_user uuid := auth.uid();
 v_claim text := pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session_id uuid;
 v_days jsonb;
 v_workouts jsonb;
 v_live jsonb;
BEGIN
 IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user THEN
  RAISE EXCEPTION 'Training day owner mismatch' USING ERRCODE='42501';
 END IF;
 IF p_athlete_date IS NULL THEN
  RAISE EXCEPTION 'Training date required' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_user)
 OR NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=v_user) THEN
  RAISE EXCEPTION 'Active Training account required' USING ERRCODE='42501';
 END IF;
 IF v_claim IS NULL OR v_claim='' THEN
  RAISE EXCEPTION 'Training read requires current Auth session' USING ERRCODE='42501';
 END IF;
 BEGIN
   v_session_id := v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'Malformed Auth session' USING ERRCODE='42501';
 END;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s
  WHERE s.id=v_session_id AND s.user_id=v_user
    AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())) THEN
  RAISE EXCEPTION 'Auth session expired, revoked or belongs to another account' USING ERRCODE='42501';
 END IF;
 -- Rest/unavailable/recovery state is a first-class calendar fact.
 WITH selected_days AS (
  SELECT d.plan_id,d.plan_revision_id,d.athlete_local_date,d.timezone,d.day_state
  FROM public.v2_training_plans p
  JOIN public.v2_training_revision_days d
   ON d.plan_id=p.id AND d.user_id=p.user_id
     AND d.plan_revision_id=p.active_revision_id
  JOIN public.v2_training_plan_revisions r
   ON r.id=d.plan_revision_id AND r.plan_id=p.id AND r.user_id=v_user
     AND r.status='accepted'
  WHERE p.user_id=v_user AND p.status='active' AND d.athlete_local_date=p_athlete_date
  ORDER BY p.id
  LIMIT 65
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'planId',plan_id,'revisionId',plan_revision_id,
    'localDate',athlete_local_date,'timezone',timezone,'dayState',day_state
 ) ORDER BY plan_id),'[]'::jsonb) INTO v_days
 FROM selected_days;
 IF pg_catalog.jsonb_array_length(v_days)>64 THEN
  RAISE EXCEPTION 'Training day has too many active plans' USING ERRCODE='54000';
 END IF;
 WITH planned AS (
  SELECT s.id,s.plan_id,s.plan_revision_id,s.session_slot_id,
   s.athlete_local_date,s.local_start_time,s.timezone,s.sport,
   s.session_kind,s.purpose,s.priority,s.intensity,
   s.duration_target_seconds,s.intent_schema_version,s.intent,
   s.sort_order,x.id AS execution_id,x.status AS execution_status,
   x.version AS execution_version
  FROM public.v2_training_revision_sessions s
  JOIN public.v2_training_plans p
    ON p.id=s.plan_id AND p.user_id=v_user
     AND p.status='active' AND p.active_revision_id=s.plan_revision_id
  JOIN public.v2_training_plan_revisions r
    ON r.id=s.plan_revision_id AND r.plan_id=s.plan_id AND r.user_id=v_user
     AND r.status='accepted'
  LEFT JOIN public.v2_training_session_instances x
    ON x.revision_session_id=s.id AND x.user_id=v_user
  WHERE s.user_id=v_user AND s.athlete_local_date=p_athlete_date
  ORDER BY s.local_start_time NULLS LAST,s.sort_order,s.id
  LIMIT 129
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'sessionId',id,'planId',plan_id,'revisionId',plan_revision_id,
  'slotId',session_slot_id,'localDate',athlete_local_date,
  'localStartTime',local_start_time,'timezone',timezone,
  'sport',sport,'sessionKind',session_kind,'purpose',purpose,
  'priority',priority,'intensity',intensity,'durationTargetSeconds',duration_target_seconds,
  'intentSchemaVersion',intent_schema_version,'intent',intent,
  'executionId',execution_id,'executionStatus',execution_status,
  'executionVersion',execution_version
 ) ORDER BY local_start_time NULLS LAST,sort_order,id),'[]'::jsonb)
 INTO v_workouts FROM planned;
 IF pg_catalog.jsonb_array_length(v_workouts)>128 THEN
   RAISE EXCEPTION 'Training day has too many workout sessions' USING ERRCODE='54000';
 END IF;
 -- This is specifically the one currently live session, regardless of
 -- whether it is ad-hoc or belongs to a previously accepted revision.
 SELECT pg_catalog.jsonb_build_object(
   'executionId',x.id,'revisionSessionId',x.revision_session_id,
   'status',x.status,'version',x.version,
   'localDate',x.athlete_local_date,'timezone',x.timezone,
   'startedAt',x.started_at
 ) INTO v_live
 FROM public.v2_training_session_instances x
 WHERE x.user_id=v_user AND x.status IN ('active','paused','finishing');
 RETURN pg_catalog.jsonb_build_object('ownerId',v_user,
   'localDate',p_athlete_date,'calendarDays',v_days,
   'plannedWorkouts',v_workouts,'liveWorkout',v_live);
END;
$read$;
REVOKE ALL ON FUNCTION public.v2_training_day_read_candidate(uuid,date)
 FROM PUBLIC,anon,authenticated,service_role;
-- Never GRANT client EXECUTE before actual Auth-session, RLS, and privacy
-- acceptance. Export and account-deletion coverage remain owning gates.
