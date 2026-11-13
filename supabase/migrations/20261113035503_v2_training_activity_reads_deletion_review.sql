-- ALL-222/243/246/251 REVIEW ONLY. DO NOT MERGE/DEPLOY. Unit 4 of 5.
-- Source-backed evidence objects, protected owner readers, owner deletion and direct-auth cascade review.

-- Source 19: V2-COMPLETED-ACTIVITY-EVIDENCE-OBJECTS-CANDIDATE.sql [Git blob ee30ca7b47b3771b1c484aaf10c6a524713cfdbe]
-- ALL-243 REVIEW ONLY. Not a migration or a Storage policy.
-- Source-linked opaque metadata, not uploaded or verified measurements.
CREATE TABLE public.v2_activity_series (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL, user_id uuid NOT NULL,
 source_id uuid NOT NULL, segment_id uuid,
 metric_code text NOT NULL, definition_version integer NOT NULL,
 object_path text NOT NULL UNIQUE, encoding text NOT NULL
  CHECK(encoding IN ('fit','compressed_json','protobuf')),
 checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
 sample_count integer NOT NULL CHECK(sample_count BETWEEN 1 AND 10000000),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 quality text NOT NULL CHECK(quality IN ('trusted','partial','unverified','low_quality','rejected')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','rejected','revoked')),
 FOREIGN KEY(activity_id,user_id) REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(source_id,activity_id,user_id) REFERENCES public.v2_activity_sources(id,activity_id,user_id),
 FOREIGN KEY(segment_id,activity_id,user_id) REFERENCES public.v2_activity_segments(id,activity_id,user_id),
 FOREIGN KEY(metric_code,definition_version) REFERENCES public.v2_activity_metric_definitions(metric_code,definition_version),
 CHECK(ends_at>=starts_at),
 CHECK(length(object_path) BETWEEN 80 AND 500),
 CHECK(left(object_path,length(user_id::text)+1)=user_id::text||'/'),
 CHECK(strpos(object_path,'..')=0 AND strpos(object_path,'//')=0)
);
CREATE TABLE public.v2_activity_route_objects (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL, user_id uuid NOT NULL,
 source_id uuid NOT NULL, object_path text NOT NULL UNIQUE,
 format text NOT NULL CHECK(format IN ('fit','gpx','encoded_route')),
 checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
 point_count integer NOT NULL CHECK(point_count BETWEEN 1 AND 5000000),
 quality text NOT NULL CHECK(quality IN ('trusted','partial','unverified','low_quality','rejected')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','rejected','revoked')),
 privacy_state text NOT NULL DEFAULT 'private' CHECK(privacy_state IN ('private','redacted')),
 FOREIGN KEY(activity_id,user_id) REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(source_id,activity_id,user_id) REFERENCES public.v2_activity_sources(id,activity_id,user_id),
 UNIQUE(activity_id,user_id,source_id,checksum_sha256),
 CHECK(length(object_path) BETWEEN 80 AND 500),
 CHECK(left(object_path,length(user_id::text)+1)=user_id::text||'/'),
 CHECK(strpos(object_path,'..')=0 AND strpos(object_path,'//')=0)
);
CREATE INDEX v2_series_owner_lookup ON public.v2_activity_series(user_id,activity_id,metric_code,state);
CREATE INDEX v2_routes_owner_lookup ON public.v2_activity_route_objects(user_id,activity_id,state,privacy_state);
ALTER TABLE public.v2_activity_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_activity_route_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_activity_series FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_activity_route_objects FROM PUBLIC,anon,authenticated;
-- No Storage bucket, direct app grants, object reader, or device attestation.


-- Source 20: V2-TRAINING-DAY-OWNER-READER-CANDIDATE.sql [Git blob 6ebe51bb74bcea35b265223f74edcccba41db1e5]
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
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=v_session_id AND s.user_id=v_user) THEN
  RAISE EXCEPTION 'Auth session revoked or belongs to another account' USING ERRCODE='42501';
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


-- Source 21: V2-COMPLETED-ACTIVITY-OWNER-DETAIL-READER-CANDIDATE.sql [Git blob 1cece465259396b8e4ecb880a47d22b36e66b78c]
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
   'segmentId',seg.id,'parentSegmentId',seg.parent_segment_id,
   'kind',seg.segment_kind,'sequence',seg.sequence_number,
   'sport',seg.sport,'label',seg.label,
   'startedAt',seg.started_at,'finishedAt',seg.finished_at,
   'elapsedSeconds',seg.elapsed_seconds,'distanceMeters',seg.distance_meters,
   -- A source-free authored segment has unknown sensor quality, not trusted.
   'sourceQuality',src.quality,
   'sourceMetrics',allin_private.v2_activity_segment_scalar_projection_candidate(
      v_user,p_activity_id,seg.id)
 ) ORDER BY seg.parent_segment_id NULLS FIRST,seg.sequence_number,seg.id),'[]'::jsonb)
 INTO v_segments FROM public.v2_activity_segments seg
 LEFT JOIN public.v2_activity_sources src ON
   src.id=seg.source_id AND src.activity_id=seg.activity_id AND src.user_id=seg.user_id
 WHERE seg.activity_id=p_activity_id AND seg.user_id=v_user;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'setId',sets.id,'exerciseSegmentId',sets.exercise_segment_id,
    'exerciseId',sets.exercise_id,'setIndex',sets.set_index,'setKind',sets.set_kind,
    'reps',sets.reps,'loadValue',sets.load_value,'loadUnit',sets.load_unit,
    'loadMode',sets.load_mode,'rpe',sets.rpe,'rir',sets.rir,
    'durationSeconds',sets.duration_seconds,'quality',sets.quality,
    'sourceQuality',src.quality
 ) ORDER BY sets.exercise_segment_id,sets.set_index,sets.id),'[]'::jsonb)
 INTO v_strength FROM public.v2_activity_strength_sets sets
 JOIN public.v2_activity_sources src ON
   src.id=sets.source_id AND src.activity_id=sets.activity_id AND src.user_id=sets.user_id
 WHERE sets.activity_id=p_activity_id AND sets.user_id=v_user;
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


-- Source 22: V2-TRAINING-ACTIVITY-OWNER-CASCADE-REVIEW-CANDIDATE.sql [Git blob 3dd88f3ee8830424e6cc5c0e44fc4aafc05c1b5c]
-- ALL-251 / ALL-222 REVIEW ONLY. Candidate for owner-deletion FK cascades.
-- NOT A MIGRATION. Only used in a disposable PG17 account-deletion replay.
-- Do NOT apply to hosted Supabase or enable account deletion processing.
--
-- This selects explicitly enumerated child -> parent ownership FKs. It does
-- not blanket-cascade metric definitions or global challenge definitions.
-- Test and review behavior for ordinary parent deletion before deployment.
DO $cascade$
DECLARE
 edge record;
 v_oid oid;
 v_count integer;
 v_name text;
 v_def text;
 v_child text;
BEGIN
 FOR edge IN
 SELECT * FROM (VALUES
 ('allin_private','v2_training_action_receipts','public','v2_training_session_instances'),
 ('public','v2_training_execution_events','public','v2_training_session_instances'),
 ('allin_private','v2_training_completion_outbox','public','v2_training_session_instances'),
 ('public','v2_completed_activities','public','v2_training_session_instances'),
 ('public','v2_training_plan_revisions','public','v2_training_plans'),
 ('public','v2_training_session_slots','public','v2_training_plans'),
 ('public','v2_training_revision_days','public','v2_training_plan_revisions'),
 ('public','v2_training_revision_sessions','public','v2_training_plan_revisions'),
 ('public','v2_training_revision_sessions','public','v2_training_session_slots'),
 ('public','v2_training_revision_sessions','public','v2_training_revision_days'),
 ('public','v2_training_session_instances','public','v2_training_revision_sessions'),
 ('public','v2_activity_metric_values','public','v2_completed_activities'),
 ('public','v2_activity_metric_values','public','v2_activity_sources'),
 ('public','v2_activity_segments','public','v2_completed_activities'),
 ('public','v2_activity_segments','public','v2_activity_segments'),
 ('public','v2_activity_segments','public','v2_activity_sources'),
 ('public','v2_activity_strength_sets','public','v2_completed_activities'),
 ('public','v2_activity_strength_sets','public','v2_activity_segments'),
 ('public','v2_activity_strength_sets','public','v2_activity_sources'),
 ('public','v2_activity_series','public','v2_completed_activities'),
 ('public','v2_activity_series','public','v2_activity_sources'),
 ('public','v2_activity_series','public','v2_activity_segments'),
 ('public','v2_activity_route_objects','public','v2_completed_activities'),
 ('public','v2_activity_route_objects','public','v2_activity_sources'),
 ('public','v2_indoor_weekly_attempts','public','v2_completed_activities'),
 ('public','v2_indoor_weekly_leaderboard','public','v2_indoor_weekly_attempts'),
 ('public','v2_indoor_weekly_achievements','public','v2_indoor_weekly_leaderboard')
 ) AS e(child_schema,child_name,parent_schema,parent_name)
 LOOP
  SELECT count(*),min(c.oid) INTO v_count,v_oid
  FROM pg_catalog.pg_constraint c
  WHERE c.contype='f'
    AND c.conrelid=pg_catalog.to_regclass(
      pg_catalog.format('%I.%I',edge.child_schema,edge.child_name))
    AND c.confrelid=pg_catalog.to_regclass(
      pg_catalog.format('%I.%I',edge.parent_schema,edge.parent_name));
  IF v_count<>1 THEN
    RAISE EXCEPTION 'Expected exactly one FK %.% -> %.%, got %',
     edge.child_schema,edge.child_name,edge.parent_schema,edge.parent_name,v_count;
  END IF;
  SELECT c.conname,pg_catalog.pg_get_constraintdef(c.oid,true)
    INTO v_name,v_def FROM pg_catalog.pg_constraint c WHERE c.oid=v_oid;
  IF v_def ~* 'ON DELETE' OR v_def ~* 'DEFERRABLE' THEN
    RAISE EXCEPTION 'Explicit FK review needed for %.%: %',
      edge.child_schema,edge.child_name,v_def;
  END IF;
  v_child:=pg_catalog.format('%I.%I',edge.child_schema,edge.child_name);
  EXECUTE pg_catalog.format('ALTER TABLE %s DROP CONSTRAINT %I',v_child,v_name);
  EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE',
    v_child,v_name,v_def);
 END LOOP;
END $cascade$;
-- The active-plan current revision owner pointer and accepted/superseded
-- immutable-history trigger require separate explicit lifecycle policy.
-- They are deliberately NOT rewritten by this FK-only candidate.


-- Source 23: V2-TRAINING-ACCOUNT-DELETION-HISTORY-GUARD-CANDIDATE.sql [Git blob 4386bba79a2d028879c33c4cf993686f628b8e9e]
-- ALL-251/ALL-246 REVIEW ONLY: protect immutable Training history while
-- allowing an actual deleted Auth owner to cascade through historical plans.
-- NOT A MIGRATION. Tested only after the original immutable-guard candidate.
-- A direct DELETE on an active account remains prohibited. This is NOT an
-- account-deletion trigger, endpoint, authorization token or bypass grant.
CREATE OR REPLACE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
DECLARE
 v_old_status text;
 v_new_status text;
BEGIN
 -- Account teardown is the only condition under which historical records
 -- may be removed. A single Auth deletion statement has already removed the
 -- owner identity by the time AFTER DELETE FK cascades enter these triggers.
 -- Direct deletes while the Auth owner exists stay prohibited.
 IF TG_OP='DELETE' AND NOT EXISTS (
   SELECT 1 FROM auth.users WHERE id=OLD.user_id
 ) THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='v2_training_plan_revisions' THEN
  IF TG_OP='DELETE' AND OLD.status<>'candidate' THEN
    RAISE EXCEPTION 'Historical Training revision cannot be deleted' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status<>'candidate' THEN
    IF OLD.status<>'accepted' OR NEW.status<>'superseded'
      OR (pg_catalog.to_jsonb(NEW)-'status') IS DISTINCT FROM
         (pg_catalog.to_jsonb(OLD)-'status') THEN
      RAISE EXCEPTION 'Accepted Training revision content cannot change'
       USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END IF;
 -- A revision-day/session belongs to precisely one immutable snapshot.
 IF TG_OP IN ('UPDATE','DELETE') THEN
  SELECT status INTO v_old_status FROM public.v2_training_plan_revisions
    WHERE id=OLD.plan_revision_id;
  IF v_old_status IS DISTINCT FROM 'candidate' THEN
    RAISE EXCEPTION 'Published Training revision children cannot change'
      USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  SELECT status INTO v_new_status FROM public.v2_training_plan_revisions
    WHERE id=NEW.plan_revision_id;
  IF v_new_status IS DISTINCT FROM 'candidate' THEN
    RAISE EXCEPTION 'Published Training revision children cannot be added'
      USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;



-- Source 24: V2-TRAINING-DIRECT-AUTH-CASCADE-REVIEW-CANDIDATE.sql [Git blob b6c65abfd9113a1fe9787fbd6a13cd0526359ad0]
-- ALL-251 / ALL-222 REVIEW-ONLY direct Auth owner-cascade compatibility.
-- NOT A MIGRATION. Never apply to hosted V2 without owner/security approval.
-- Existing ALL-251 deletion-claim preflight requires a direct user_id FK
-- to auth.users with ON DELETE CASCADE for EVERY user-owned table. Indirect
-- parent cascades alone are insufficient. This candidate closes that gap.
DO $direct_owner$
DECLARE
 edge record;
 v_target regclass;
 v_auth regclass:='auth.users'::regclass;
 v_user_column smallint;
BEGIN
 FOR edge IN SELECT * FROM (VALUES
  ('public','v2_training_plan_revisions'),
  ('public','v2_training_session_slots'),
  ('public','v2_training_revision_days'),
  ('public','v2_training_revision_sessions'),
  ('public','v2_training_execution_events'),
  ('allin_private','v2_training_completion_outbox'),
  ('public','v2_activity_metric_values'),
  ('public','v2_activity_segments'),
  ('public','v2_activity_strength_sets'),
  ('public','v2_activity_series'),
  ('public','v2_activity_route_objects'),
  ('public','v2_indoor_weekly_achievements')
 ) AS x(schema_name,table_name)
 LOOP
   v_target:=pg_catalog.to_regclass(
     pg_catalog.format('%I.%I',edge.schema_name,edge.table_name));
   IF v_target IS NULL THEN
     RAISE EXCEPTION 'Missing owner table %.%',edge.schema_name,edge.table_name;
   END IF;
   SELECT attnum INTO v_user_column FROM pg_catalog.pg_attribute
    WHERE attrelid=v_target AND attname='user_id'
      AND NOT attisdropped AND attnum>0 AND attnotnull;
   IF v_user_column IS NULL THEN
     RAISE EXCEPTION 'Owner column user_id missing/nullable in %.%',
       edge.schema_name,edge.table_name;
   END IF;
   IF EXISTS (
     SELECT 1 FROM pg_catalog.pg_constraint fk
     WHERE fk.conrelid=v_target AND fk.confrelid=v_auth
       AND fk.contype='f' AND fk.confdeltype='c'
       AND fk.conkey=ARRAY[v_user_column]::smallint[]
   ) THEN CONTINUE; END IF;
   EXECUTE pg_catalog.format(
     'ALTER TABLE %I.%I ADD CONSTRAINT v2_owner_auth_cascade_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
       edge.schema_name,edge.table_name);
 END LOOP;
END $direct_owner$;
-- Do NOT weaken the existing ALL-251 deletion claim preflight or let the
-- database cascade replace Storage cleanup and delete completion receipts.

