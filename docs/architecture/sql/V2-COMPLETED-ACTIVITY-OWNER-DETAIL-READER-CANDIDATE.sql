-- ALL-243 / ALL-222 REVIEW ONLY: one authenticated Completed Activity detail.
-- NOT a migration or app grant. Never returns raw Storage paths, object
-- bytes, signed URLs, provider secrets or unsupported/guessed sport metrics.
-- Uses existing source-backed global and per-segment projections.
CREATE FUNCTION public.v2_completed_activity_detail_candidate(
 p_expected_user_id uuid,p_activity_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $detail$
DECLARE
 v_user uuid := auth.uid();
 v_claim text := pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session_id uuid;
 v_activity public.v2_completed_activities%ROWTYPE;
 v_sources jsonb;
 v_segments jsonb;
 v_strength jsonb;
 v_routes bigint;
 v_series bigint;
BEGIN
 IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user
    OR p_activity_id IS NULL THEN
  RAISE EXCEPTION 'Completed Activity owner mismatch' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_user)
 OR NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=v_user) THEN
  RAISE EXCEPTION 'Active V2 account required' USING ERRCODE='42501'; END IF;
 IF v_claim IS NULL OR v_claim='' THEN
  RAISE EXCEPTION 'Current Auth session required' USING ERRCODE='42501'; END IF;
 BEGIN
  v_session_id:=v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid Auth session identifier' USING ERRCODE='42501'; END;
 -- A present but expired Auth session is not a valid owner read.
 -- Use a timestamp, never current_time (time-of-day without the date).
 IF NOT EXISTS(SELECT 1 FROM auth.sessions AS s
  WHERE s.id=v_session_id AND s.user_id=v_user
    AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())) THEN
  RAISE EXCEPTION 'Auth session is expired or revoked' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_activity FROM public.v2_completed_activities
 WHERE id=p_activity_id AND user_id=v_user;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Completed Activity does not belong to owner' USING ERRCODE='42501'; END IF;
 -- Hard bounds make accidental enormous workout histories a controlled
 -- response instead of an unbounded JSON aggregation.
 IF (SELECT count(*) FROM public.v2_activity_sources
      WHERE activity_id=p_activity_id AND user_id=v_user)>128
 OR (SELECT count(*) FROM public.v2_activity_segments
      WHERE activity_id=p_activity_id AND user_id=v_user)>512
 OR (SELECT count(*) FROM public.v2_activity_strength_sets
      WHERE activity_id=p_activity_id AND user_id=v_user)>2048 THEN
  RAISE EXCEPTION 'Completed Activity detail exceeds bounded response'
    USING ERRCODE='54000'; END IF;
 -- Provider's private record ID/device ref intentionally omitted.
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'provider',provider,'sourceKind',source_kind,'quality',quality
 ) ORDER BY provider,source_kind,id),'[]'::jsonb)
 INTO v_sources FROM public.v2_activity_sources
 WHERE activity_id=p_activity_id AND user_id=v_user;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'segmentId',id,'parentSegmentId',parent_segment_id,
   'kind',segment_kind,'sequence',sequence_number,'sport',sport,'label',label,
   'startedAt',started_at,'finishedAt',finished_at,
   'elapsedSeconds',elapsed_seconds,'distanceMeters',distance_meters,
   'sourceMetrics',allin_private.v2_activity_segment_scalar_projection_candidate(
      v_user,p_activity_id,id)
 ) ORDER BY parent_segment_id NULLS FIRST,sequence_number,id),'[]'::jsonb)
 INTO v_segments FROM public.v2_activity_segments
 WHERE activity_id=p_activity_id AND user_id=v_user;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'setId',id,'exerciseSegmentId',exercise_segment_id,
    'exerciseId',exercise_id,'setIndex',set_index,'setKind',set_kind,
    'reps',reps,'loadValue',load_value,'loadUnit',load_unit,
    'loadMode',load_mode,'rpe',rpe,'rir',rir,
    'durationSeconds',duration_seconds,'quality',quality
 ) ORDER BY exercise_segment_id,set_index,id),'[]'::jsonb)
 INTO v_strength FROM public.v2_activity_strength_sets
 WHERE activity_id=p_activity_id AND user_id=v_user;
 -- Storage references stay private; this count is not proof of a usable
 -- map or permission to download GPS points/series.
 SELECT count(*) INTO v_routes
 FROM public.v2_activity_route_objects r
 JOIN public.v2_activity_sources src
   ON src.id=r.source_id AND src.activity_id=r.activity_id AND src.user_id=r.user_id
 WHERE r.activity_id=p_activity_id AND r.user_id=v_user AND r.state='ready'
   AND r.privacy_state IN ('private','redacted')
   AND r.quality IN ('trusted','partial')
   AND src.quality IN ('trusted','partial');
 SELECT count(*) INTO v_series
 FROM public.v2_activity_series series
 JOIN public.v2_activity_sources src
   ON src.id=series.source_id AND src.activity_id=series.activity_id
      AND src.user_id=series.user_id
 WHERE series.activity_id=p_activity_id AND series.user_id=v_user
   AND series.state='ready' AND series.quality IN ('trusted','partial')
   AND src.quality IN ('trusted','partial');
 RETURN pg_catalog.jsonb_build_object(
   -- Certified identity/revision is required by the existing mobile
   -- CompletedActivityScreenContent state isolation and owner reader.
   'activityId',v_activity.id,'ownerId',v_activity.user_id,
   'version',v_activity.version,'sport',v_activity.sport,
   'sportSubtype',v_activity.sport_subtype,
   'activityKind',v_activity.activity_kind,'status',v_activity.status,
   'localDate',v_activity.athlete_local_date,'timezone',v_activity.timezone,
   'startedAt',v_activity.started_at,'finishedAt',v_activity.finished_at,
   'durationSeconds',v_activity.duration_seconds,
   'elapsedSeconds',v_activity.elapsed_seconds,
   'captureKind',v_activity.capture_kind,
   'trainingSessionId',v_activity.training_session_instance_id,
   'sources',v_sources,
   'activityMetrics',allin_private.v2_activity_scalar_evidence_projection_candidate(
      v_user,p_activity_id),
   'segments',v_segments,'strengthSets',v_strength,
   'readyPrivateRouteCount',v_routes,
   'readySeriesCount',v_series,
   'coverage','source_backed_partial_activity_detail');
END;
$detail$;
REVOKE ALL ON FUNCTION public.v2_completed_activity_detail_candidate(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit security/release acceptance required before any client grant.
