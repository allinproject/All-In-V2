-- ALL-222/243/246/253 REVIEW ONLY. DO NOT MERGE/DEPLOY. Unit 3 of 5.
-- Activity handoff and idempotency; optional indoor competition needs separate ALL-253 release approval.

-- Source 13: V2-COMPLETED-ACTIVITY-SEGMENT-SCALAR-READ-CANDIDATE.sql [Git blob 10a8c469ff6ac1e2cdd8a60c19f3a219b5d138be]
-- ALL-243 REVIEW ONLY: evidence-aware scalar metrics for ONE canonical
-- lap/interval/swim set/strength exercise/multisport leg. Never mixes
-- separate segments into a false same-source disagreement.
-- NOT a migration; NO client grant, no fabricated/estimated metrics.
CREATE FUNCTION allin_private.v2_activity_segment_scalar_projection_candidate(
 p_user_id uuid,p_activity_id uuid,p_segment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $segment_projection$
DECLARE
 v_sport text;
 v_parent_sport text;
 v_activity_status text;
 v_values jsonb;
 v_conflicts jsonb;
BEGIN
 IF p_user_id IS NULL OR p_activity_id IS NULL OR p_segment_id IS NULL THEN
  RAISE EXCEPTION 'Segment owner and identity required' USING ERRCODE='22023'; END IF;
 -- An event's parent sport can be 'multisport', but power, running pace,
 -- swim stroke etc. are governed by the recorded LEG sport. Descendants
 -- inherit the nearest explicitly recorded ancestor sport in the SAME
 -- owner/activity graph. Never use a metric's own sport to infer the leg.
 WITH RECURSIVE lineage AS (
   SELECT seg.id,seg.parent_segment_id,seg.sport,0 AS depth
   FROM public.v2_activity_segments seg
   WHERE seg.id=p_segment_id AND seg.activity_id=p_activity_id AND seg.user_id=p_user_id
   UNION ALL
   SELECT parent.id,parent.parent_segment_id,parent.sport,child.depth+1
   FROM public.v2_activity_segments parent
   JOIN lineage child ON parent.id=child.parent_segment_id
   WHERE parent.activity_id=p_activity_id AND parent.user_id=p_user_id
     AND child.depth<32
 )
 SELECT a.sport,a.status,
   coalesce((SELECT l.sport FROM lineage l
     WHERE l.sport IS NOT NULL ORDER BY l.depth LIMIT 1),a.sport)
 INTO v_parent_sport,v_activity_status,v_sport
 FROM public.v2_completed_activities a
 WHERE a.id=p_activity_id AND a.user_id=p_user_id
   AND EXISTS(SELECT 1 FROM lineage);
 IF v_sport IS NULL THEN
  RAISE EXCEPTION 'Activity segment not owned or unavailable' USING ERRCODE='42501';
 END IF;
 -- Match the global projection: retain raw evidence privately, but do
 -- not display any segment measurements after parent invalidation.
 IF v_activity_status='invalidated' THEN
  RETURN pg_catalog.jsonb_build_object(
   'activityId',p_activity_id,'segmentId',p_segment_id,
   'metrics','[]'::jsonb,'unresolvedMetrics','[]'::jsonb,
   'coverage','invalidated_activity');
 END IF;
 IF v_parent_sport<>'multisport' AND v_sport<>v_parent_sport THEN
  RAISE EXCEPTION 'Segment sport contradicts canonical activity sport'
    USING ERRCODE='22023';
 END IF;
 -- A metric is "agreed" only when trusted/partial evidence for this exact
 -- segment has one typed value and measurement kind across all sources.
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,d.canonical_unit,
    m.value_numeric,m.value_text,m.value_boolean,m.measurement_kind,
   m.quality AS measurement_quality,s.quality AS source_quality,
    CASE
      WHEN m.quality IN ('trusted','partial') AND s.quality IN ('trusted','partial')
       THEN CASE WHEN m.quality='partial' OR s.quality='partial'
                 THEN 'partial' ELSE 'trusted' END
      ELSE 'unverified'
    END AS quality
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
    ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
    ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.user_id=p_user_id AND m.activity_id=p_activity_id
    AND m.segment_id=p_segment_id AND d.status='published'
    AND v_sport=ANY(d.sport_scope)
 ), grouped AS (
  SELECT metric_code,definition_version,canonical_unit,
   count(*) AS source_count,
   count(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS insufficient,
   count(DISTINCT pg_catalog.jsonb_build_array(
      value_numeric,value_text,value_boolean,measurement_kind)) AS facts
  FROM rows GROUP BY metric_code,definition_version,canonical_unit
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'segmentId',p_segment_id,'metricCode',g.metric_code,
   'definitionVersion',g.definition_version,'canonicalUnit',g.canonical_unit,
   'sourceCount',g.source_count,
   'measurementQuality',CASE WHEN EXISTS(
     SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
      AND r.definition_version=g.definition_version AND r.measurement_quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'sourceQuality',CASE WHEN EXISTS(
     SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
      AND r.definition_version=g.definition_version AND r.source_quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'quality',CASE WHEN EXISTS(
      SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
        AND r.definition_version=g.definition_version AND r.quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'valueNumeric',(SELECT r.value_numeric FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'valueText',(SELECT r.value_text FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'valueBoolean',(SELECT r.value_boolean FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'measurementKind',(SELECT r.measurement_kind FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1)
 ) ORDER BY g.metric_code,g.definition_version),'[]'::jsonb)
 INTO v_values
 FROM grouped g WHERE g.insufficient=0 AND g.facts=1
 AND (SELECT count(DISTINCT r.definition_version) FROM rows r
      WHERE r.metric_code=g.metric_code)=1;
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,m.value_numeric,m.value_text,
   m.value_boolean,m.measurement_kind,
   CASE
      WHEN m.quality IN ('trusted','partial') AND s.quality IN ('trusted','partial')
       THEN CASE WHEN m.quality='partial' OR s.quality='partial'
                 THEN 'partial' ELSE 'trusted' END
      ELSE 'unverified'
    END AS quality
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
    ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
    ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.user_id=p_user_id AND m.activity_id=p_activity_id
    AND m.segment_id=p_segment_id AND d.status='published'
    AND v_sport=ANY(d.sport_scope)
 ), grouped AS (
   SELECT metric_code,MIN(definition_version) AS definition_version,
     count(DISTINCT definition_version) AS version_count,
     count(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS insufficient,
     count(DISTINCT pg_catalog.jsonb_build_array(
       value_numeric,value_text,value_boolean,measurement_kind)) AS facts
   FROM rows GROUP BY metric_code
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'segmentId',p_segment_id,'metricCode',metric_code,
   'definitionVersion',CASE WHEN version_count=1 THEN definition_version ELSE NULL END,
   'reason',CASE WHEN version_count>1 THEN 'conflicting_versions'
           WHEN insufficient>0 THEN 'source_review_required'
           ELSE 'conflicting_sources' END
 ) ORDER BY metric_code,definition_version),'[]'::jsonb)
 INTO v_conflicts
 FROM grouped WHERE version_count>1 OR insufficient>0 OR facts<>1;
 RETURN pg_catalog.jsonb_build_object('activityId',p_activity_id,
   'segmentId',p_segment_id,'metrics',v_values,
   'unresolvedMetrics',v_conflicts,'coverage','source_backed_segment_partial_registry');
END;
$segment_projection$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_segment_scalar_projection_candidate(
 uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;


-- Source 14: V2-TRAINING-COMPLETION-ACK-CANDIDATE.sql [Git blob 146096abb31ab93404303ea5ee1973428da46c90]
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


-- Source 15: V2-TRAINING-ACTIVITY-OUTBOX-WRITER-CANDIDATE.sql [Git blob 6ecbf416462453d8c4a77e2a712eefa64bb87bf9]
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


-- Source 16: V2-TRAINING-START-PLANNED-WORKOUT-CANDIDATE.sql [Git blob 6f98c51b616abd2eda8dae6137cb0cd5accf15c2]
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


-- Source 17: V2-INDOOR-WEEKLY-COMPETITION-OWNER-CANDIDATE.sql [Git blob 4516ff4d636fbe942715bfc0a0bca49c9d794eb3]
-- ALL-253 / ALL-222 REVIEW-ONLY V2 WEEKLY INDOOR COMPETITION OWNER CANDIDATE.
-- NOT A MIGRATION. DO NOT APPLY TO HOSTED V2 OR ENABLE SCHEDULED PUBLICATION.
-- Depends on approved ALL-243 public.v2_completed_activities(id,user_id) unique
-- owner pair, and ALL-245 certified cycling power/source evidence. NO V1 data port.
-- All mutations must occur through future service-owned audited writer/worker.
-- The SQL below is intentionally a candidate and omits activation RPC/cron.

CREATE TABLE public.v2_indoor_weekly_challenges (
  id uuid PRIMARY KEY,
  week_start date NOT NULL UNIQUE
    CHECK (extract(isodow FROM week_start)=1),
  timezone text NOT NULL DEFAULT 'America/Chicago'
    CHECK (timezone='America/Chicago'),
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','open','closed','finalized')),
  rules_version text NOT NULL CHECK (length(btrim(rules_version)) BETWEEN 1 AND 80),
  generator_version text NOT NULL CHECK (length(btrim(generator_version)) BETWEEN 1 AND 80),
  scoring_version text NOT NULL CHECK (scoring_version='challenge-score-v1'),
  prescription_version text NOT NULL CHECK (length(btrim(prescription_version)) BETWEEN 1 AND 80),
  common_structure_id text NOT NULL CHECK (length(btrim(common_structure_id)) BETWEEN 1 AND 160),
  workout_definition jsonb NOT NULL CHECK (jsonb_typeof(workout_definition)='object'),
  scored_effort_definition jsonb NOT NULL CHECK (jsonb_typeof(scored_effort_definition)='object'),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  published_at timestamptz,
  closed_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < closes_at),
  CHECK (state='draft' OR published_at IS NOT NULL),
  CHECK (state <> 'finalized' OR finalized_at IS NOT NULL)
);
COMMENT ON TABLE public.v2_indoor_weekly_challenges IS
  'ALL-253 REVIEW ONLY: V2 global challenge identity, same authored workout for everyone, not published.';

CREATE TABLE public.v2_indoor_weekly_attempts (
  id uuid PRIMARY KEY,
  challenge_id uuid NOT NULL REFERENCES public.v2_indoor_weekly_challenges(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Cross-owner completed activity FK intentionally required; cannot apply
  -- before ALL-243 approves the owner unique(id,user_id) and activity writer.
  completed_activity_id uuid NOT NULL,
  training_session_instance_id uuid,
  frozen_prescription_version text NOT NULL
    CHECK (length(btrim(frozen_prescription_version)) BETWEEN 1 AND 80),
  frozen_prescription jsonb NOT NULL CHECK (jsonb_typeof(frozen_prescription)='object'),
  frozen_baseline jsonb NOT NULL CHECK (jsonb_typeof(frozen_baseline)='object'),
  source_qualification_ref text,
  verification_state text NOT NULL DEFAULT 'pending'
    CHECK (verification_state IN ('pending','verified','unverified','rejected','revoked')),
  final_integrity_state text NOT NULL DEFAULT 'pending'
    CHECK (final_integrity_state IN ('pending','accepted','rejected','revoked')),
  score numeric(10,3),
  scoring_version text CHECK (scoring_version IS NULL OR scoring_version='challenge-score-v1'),
  telemetry_fingerprint text,
  completed_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id,completed_activity_id),
  UNIQUE (id,challenge_id,user_id),
  FOREIGN KEY (completed_activity_id,user_id)
    REFERENCES public.v2_completed_activities(id,user_id),
  CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CHECK (verification_state <> 'verified' OR
    (score IS NOT NULL AND scoring_version IS NOT NULL AND
      verified_at IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (final_integrity_state <> 'accepted' OR verification_state='verified')
);
CREATE INDEX v2_indoor_weekly_attempts_owner_idx
  ON public.v2_indoor_weekly_attempts(challenge_id,user_id,created_at DESC);
CREATE INDEX v2_indoor_weekly_attempts_verified_idx
  ON public.v2_indoor_weekly_attempts(challenge_id,score DESC,completed_at,id)
  WHERE verification_state='verified' AND score IS NOT NULL;

CREATE TABLE public.v2_indoor_weekly_leaderboard (
  challenge_id uuid NOT NULL REFERENCES public.v2_indoor_weekly_challenges(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  best_attempt_id uuid NOT NULL,
  best_score numeric(10,3) NOT NULL CHECK (best_score BETWEEN 0 AND 100),
  live_rank integer CHECK (live_rank>0),
  final_rank integer CHECK (final_rank>0),
  finalized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id,user_id),
  FOREIGN KEY (best_attempt_id,challenge_id,user_id)
    REFERENCES public.v2_indoor_weekly_attempts(id,challenge_id,user_id),
  CHECK (final_rank IS NULL OR finalized_at IS NOT NULL)
);
COMMENT ON TABLE public.v2_indoor_weekly_leaderboard IS
  'ALL-253 REVIEW ONLY: service-recomputed best VERIFIED attempt, never client-submitted score.';

CREATE TABLE public.v2_indoor_weekly_achievements (
  challenge_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tier text NOT NULL CHECK (tier IN ('champion','top_5','top_10')),
  final_rank integer NOT NULL CHECK (final_rank BETWEEN 1 AND 10),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  PRIMARY KEY (challenge_id,user_id),
  FOREIGN KEY (challenge_id,user_id)
    REFERENCES public.v2_indoor_weekly_leaderboard(challenge_id,user_id),
  CHECK ((tier='champion' AND final_rank=1) OR
         (tier='top_5' AND final_rank BETWEEN 2 AND 5) OR
         (tier='top_10' AND final_rank BETWEEN 6 AND 10))
);

CREATE TABLE allin_private.v2_indoor_weekly_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation_enabled boolean NOT NULL DEFAULT false CHECK (generation_enabled=false),
  publication_enabled boolean NOT NULL DEFAULT false CHECK (publication_enabled=false),
  finalization_enabled boolean NOT NULL DEFAULT false CHECK (finalization_enabled=false),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO allin_private.v2_indoor_weekly_config(singleton) VALUES (true);

-- No direct client writes or unrestricted Data API reads. No future RPC grants.
ALTER TABLE public.v2_indoor_weekly_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_indoor_weekly_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_indoor_weekly_leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_indoor_weekly_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_indoor_weekly_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_indoor_weekly_challenges FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_indoor_weekly_attempts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_indoor_weekly_leaderboard FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_indoor_weekly_achievements FROM PUBLIC,anon,authenticated;
REVOKE ALL ON allin_private.v2_indoor_weekly_config FROM PUBLIC,anon,authenticated;
-- No generic owner INSERT/UPDATE/DELETE policy, no public/anon EXECUTE grant.
-- A separate reviewed server writer must validate challenge generation, owner
-- source evidence, immutable frozen prescriptions and server scoring before
-- marking an attempt verified or selecting a leaderboard best attempt.
-- Existing 'false' CHECKs make accidental activation impossible: a later
-- explicitly reviewed migration must replace them after hardware acceptance.


-- Source 18: V2-INDOOR-WEEKLY-SCORE-V1-CANDIDATE.sql [Git blob 361d0cb1f02cdcc9e10a06a3bc43a62f3af7a251]
-- ALL-253 REVIEW ONLY. V1 challenge-score-v1 SQL parity candidate for V2.
-- NOT A MIGRATION. No grants to clients. No score submission RPC.
-- Sole source reference: V1 allin_private.weekly_challenge_score_breakdown_v1
-- inspected 2026-11-11. The trusted competition service must derive all
-- arguments from canonical Completed Activity power samples, frozen baseline,
-- interval coverage and verified source evidence; never accept client values.
CREATE OR REPLACE FUNCTION allin_private.v2_indoor_weekly_score_breakdown_v1(
  p_completion numeric,
  p_execution numeric,
  p_relative_ftp numeric
) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=''
AS $score$
SELECT jsonb_build_object(
  'version','challenge-score-v1',
  'completionFraction',round(greatest(0::numeric,least(1::numeric,coalesce(p_completion,0))),5),
  'prescribedExecutionIndex',round(greatest(0::numeric,least(1::numeric,coalesce(p_execution,0))),5),
  'scoredEffortRelativeToFtp',CASE WHEN p_relative_ftp IS NULL THEN NULL ELSE round(p_relative_ftp,5) END,
  'completionPoints',round(20*greatest(0::numeric,least(1::numeric,coalesce(p_completion,0))),3),
  'executionPoints',round(30*greatest(0::numeric,least(1::numeric,coalesce(p_execution,0))),3),
  'scoredEffortPoints',round(50*greatest(0::numeric,least(1::numeric,coalesce(p_relative_ftp,0)/2)),3),
  'score',round(
    20*greatest(0::numeric,least(1::numeric,coalesce(p_completion,0)))+
    30*greatest(0::numeric,least(1::numeric,coalesce(p_execution,0)))+
    50*greatest(0::numeric,least(1::numeric,coalesce(p_relative_ftp,0)/2)),3
  )
);
$score$;
REVOKE ALL ON FUNCTION allin_private.v2_indoor_weekly_score_breakdown_v1(numeric,numeric,numeric)
  FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION allin_private.v2_indoor_weekly_score_breakdown_v1(numeric,numeric,numeric) IS
  'Review-only exact V1 NUMERIC score breakdown; args must come only from trusted server reconciliation, not clients.';

