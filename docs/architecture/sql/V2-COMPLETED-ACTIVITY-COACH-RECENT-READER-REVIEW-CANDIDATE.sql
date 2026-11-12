-- ALL-217 / ALL-232 / ALL-243 REVIEW ONLY. Do not deploy or GRANT
-- before canonical Completed Activity owner installation and Auth acceptance.
-- Coach reads bounded canonical activity identities, NOT a duplicate history.
-- No unsupported PR, sensor, health or GPS metrics; absence is not no workouts.
CREATE FUNCTION public.v2_completed_activity_coach_recent_candidate(
 p_expected_user_id uuid,p_from_date date,p_through_date date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path='' AS $history$
DECLARE
 v_user uuid:=auth.uid();
 v_session text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_sid uuid;
 v_count integer;
 v_rows jsonb;
BEGIN
 IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user THEN
  RAISE EXCEPTION 'Completed history owner mismatch' USING ERRCODE='42501'; END IF;
 IF p_from_date IS NULL OR p_through_date IS NULL OR
    p_from_date>p_through_date OR p_through_date-p_from_date>30 OR
    p_through_date>current_date+1 THEN
  RAISE EXCEPTION 'Invalid bounded completed history window' USING ERRCODE='22023'; END IF;
 IF v_session IS NULL OR v_session='' THEN
  RAISE EXCEPTION 'Current Auth session required' USING ERRCODE='42501'; END IF;
 BEGIN v_sid:=v_session::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid Auth session ID' USING ERRCODE='42501'; END;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_user) OR
    NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=v_user) OR
    NOT EXISTS(SELECT 1 FROM auth.sessions s
      WHERE s.id=v_sid AND s.user_id=v_user
        AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())) THEN
  RAISE EXCEPTION 'Revoked or cross-owner Completed Activity session'
    USING ERRCODE='42501'; END IF;
 WITH selected AS (
  SELECT a.id,a.sport,a.athlete_local_date,a.status,a.activity_kind,
    a.started_at,a.finished_at,a.created_at,a.capture_kind,a.version,
    a.duration_seconds
  FROM public.v2_completed_activities a
  WHERE a.user_id=v_user AND
    a.athlete_local_date BETWEEN p_from_date AND p_through_date
    AND a.status IN ('completed','partial','needs_review')
  ORDER BY a.athlete_local_date DESC,a.id DESC LIMIT 51
 ) SELECT count(*) INTO v_count FROM selected;
 -- More than 50 never means "complete"; return the newest 50 only.
 WITH selected AS (
  SELECT a.id,a.sport,a.athlete_local_date,a.status,a.activity_kind,
    a.started_at,a.finished_at,a.created_at,a.capture_kind,a.version,
    a.duration_seconds
  FROM public.v2_completed_activities a
  WHERE a.user_id=v_user AND
    a.athlete_local_date BETWEEN p_from_date AND p_through_date
    AND a.status IN ('completed','partial','needs_review')
  ORDER BY a.athlete_local_date DESC,a.id DESC LIMIT 50
 ) SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'activityId',id,'ownerId',v_user,'sport',sport,'localDate',athlete_local_date,
    'status',status,'kind',activity_kind,'startedAt',started_at,
    'finishedAt',finished_at,'recordedAt',created_at,
    'captureKind',capture_kind,'version',version,
    'durationSeconds',duration_seconds
 ) ORDER BY athlete_local_date DESC,id DESC),'[]'::jsonb)
 INTO v_rows FROM selected;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',v_user,'fromDate',p_from_date,'throughDate',p_through_date,
  'verified',true,'coverage','partial_canonical_completed_identity',
  'moreAvailable',v_count>50,'activities',v_rows);
END;$history$;
REVOKE ALL ON FUNCTION public.v2_completed_activity_coach_recent_candidate(
 uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
-- The completed activity owner must explicitly review and grant this after
-- Auth/session, completeness, consent and owner export/delete acceptance.
