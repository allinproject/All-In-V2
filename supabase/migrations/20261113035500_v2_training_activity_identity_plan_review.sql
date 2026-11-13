-- ALL-222/246/243 REVIEW ONLY. NO HOSTED DEPLOYMENT OR MERGE AUTHORIZED.
-- Unit 1 of 5: canonical owner identity, accepted plan revisions, execution, private gateways.
-- Must be replayed only with all five ordered units after separate exact SQL/ACL approval.

-- Source 1: V2-TRAINING-COMPLETED-IDENTITY-OWNER-CANDIDATE.sql [Git blob 339a96e7cd101ec6d0224373e070650da71aa87f]
-- ALL-222 / ALL-243 / ALL-246 REVIEW-ONLY CANONICAL WORKOUT OWNER FOUNDATION
-- NOT A MIGRATION. NOT AUTHORIZED FOR LIVE V2 DEPLOYMENT.
-- This is the narrow shared identity slice, not full Training plan/metric schemas.
-- Any live writer, RLS read grant or migration requires owner approval.
-- V2 user/account identity is auth.users(id); no imported V1 personal records.

CREATE TABLE public.v2_training_session_instances (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- References approved plan-revision-session only when the Training owner
  -- has established its canonical plan tables and immutable revision writer.
  revision_session_id uuid,
  status text NOT NULL CHECK (
    status IN ('active','paused','finishing','completed','cancelled','abandoned','skipped')
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN ('phone','watch','supported_equipment','manual','import_handoff')
  ),
  started_at timestamptz,
  finished_at timestamptz,
  athlete_local_date date NOT NULL,
  timezone text NOT NULL CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
  version bigint NOT NULL DEFAULT 1 CHECK (version>=1),
  last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CHECK (status NOT IN ('active','paused','finishing') OR finished_at IS NULL)
);
CREATE UNIQUE INDEX v2_training_one_live_session_per_athlete
  ON public.v2_training_session_instances(user_id)
  WHERE status IN ('active','paused','finishing');
CREATE UNIQUE INDEX v2_training_revision_session_single_execution
  ON public.v2_training_session_instances(user_id,revision_session_id)
  WHERE revision_session_id IS NOT NULL;
COMMENT ON TABLE public.v2_training_session_instances IS
  'REVIEW ONLY ALL-246 canonical Training execution envelope; no workout metrics and no client writer.';

CREATE TABLE public.v2_completed_activities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport text NOT NULL CHECK (
    sport IN ('running','walking','cycling','swimming','strength','hiking','rucking',
              'rowing','elliptical','stair','yoga','mobility','hiit','multisport','other')
  ),
  sport_subtype text CHECK (sport_subtype IS NULL OR length(btrim(sport_subtype)) BETWEEN 1 AND 100),
  activity_kind text NOT NULL CHECK (
    activity_kind IN ('workout','race','competition','manual_entry','free_activity')
  ),
  started_at timestamptz,
  finished_at timestamptz,
  athlete_local_date date NOT NULL,
  timezone text NOT NULL CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds>=0),
  elapsed_seconds integer CHECK (elapsed_seconds IS NULL OR elapsed_seconds>=0),
  capture_kind text NOT NULL CHECK (
    capture_kind IN ('device_measured','provider_import','user_reported','manual_only','mixed_sources')
  ),
  status text NOT NULL CHECK (status IN ('completed','partial','needs_review','invalidated')),
  -- Non-null only for a proven SAME physical workout. Imported-only activities
  -- legitimately have no Training execution identity.
  training_session_instance_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,user_id),
  UNIQUE (training_session_instance_id),
  FOREIGN KEY (training_session_instance_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX v2_completed_owner_date
  ON public.v2_completed_activities(user_id,athlete_local_date,id);
COMMENT ON TABLE public.v2_completed_activities IS
  'REVIEW ONLY ALL-243 one canonical completed activity per physical workout; no synthetic sensor metrics.';

CREATE TABLE public.v2_activity_sources (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (
    provider IN ('apple_healthkit','apple_watch','supported_equipment','manual','import')
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN ('workout_record','sensor_summary','manual_record',
                    'device_session','imported_historical_record')
  ),
  -- Preserve provider-native record identity but reject blanks and
  -- uncontrolled leading/trailing whitespace that would evade deduplication.
  -- Provider namespace/certification still belongs to the trusted adapter.
  source_record_id text NOT NULL CHECK (
    length(source_record_id) BETWEEN 1 AND 500
    AND source_record_id=pg_catalog.btrim(source_record_id)
  ),
  source_revision text CHECK (
    source_revision IS NULL OR
    (length(pg_catalog.btrim(source_revision)) BETWEEN 1 AND 160
     AND source_revision=pg_catalog.btrim(source_revision))
  ),
  source_device_ref text CHECK (
    source_device_ref IS NULL OR
    (length(pg_catalog.btrim(source_device_ref)) BETWEEN 1 AND 250
     AND source_device_ref=pg_catalog.btrim(source_device_ref))
  ),
  quality text NOT NULL CHECK (quality IN ('trusted','partial','unverified','low_quality','rejected')),
  captured_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  source_payload_hash text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_metadata)='object'
       AND octet_length(source_metadata::text)<=4096),
  FOREIGN KEY (activity_id,user_id)
    REFERENCES public.v2_completed_activities(id,user_id) ON DELETE CASCADE,
  -- Exact provider source may never independently create a second completed activity.
  -- This scope is per-athlete, unlike cross-athlete provider IDs.
  UNIQUE(user_id,provider,source_kind,source_record_id)
);
CREATE INDEX v2_activity_sources_activity
  ON public.v2_activity_sources(user_id,activity_id);
COMMENT ON TABLE public.v2_activity_sources IS
  'REVIEW ONLY ALL-243 owner-bound source identity and idempotent provider imports; no raw HealthKit payload.';

-- Defense in depth: no anon/authenticated direct read or write before owner RPC
-- and confirmed RLS decisions. The future read endpoint must be authenticated,
-- owner-scoped, coverage-certified, and privacy-safe at query source.
ALTER TABLE public.v2_training_session_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_completed_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_activity_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_training_session_instances FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_completed_activities FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_activity_sources FROM PUBLIC,anon,authenticated;
-- No public functions, permissive policies, source writer or cron.


-- Source 2: V2-TRAINING-PLAN-CALENDAR-OWNER-CANDIDATE.sql [Git blob d9b2678558bf6907b8a652fff9dac528864901f8]
-- ALL-222/246 REVIEW ONLY, canonical Training plan/calendar ownership candidate.
-- NOT a migration, NO app grants, NO live deployment. Builds on the existing
-- V2-TRAINING-COMPLETED-IDENTITY-OWNER-CANDIDATE.sql. No duplicate calendar.
-- Coach may propose revisions but cannot mutate accepted plans directly.
CREATE TABLE public.v2_training_plans (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 plan_kind text NOT NULL CHECK(plan_kind IN ('race','goal','general','maintenance','return_to_training','hybrid_event')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed','archived')),
 active_revision_id uuid,
 version bigint NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id)
);
CREATE TABLE public.v2_training_plan_revisions (
 id uuid PRIMARY KEY,
 plan_id uuid NOT NULL,
 user_id uuid NOT NULL,
 revision_number integer NOT NULL CHECK(revision_number>=1),
 -- Candidate drafts can be incomplete. Acceptance requires all three explicit
 -- immutable calendar coverage values; never derive them from inserted days.
 calendar_start_date date,
 calendar_end_date date,
 calendar_timezone text CHECK(
   calendar_timezone IS NULL OR length(btrim(calendar_timezone)) BETWEEN 1 AND 100
 ),
 status text NOT NULL DEFAULT 'candidate'
  CHECK(status IN ('candidate','accepted','superseded','rejected','archived')),
 source_kind text NOT NULL
  CHECK(source_kind IN ('athlete_authored','coach_proposal','imported_template','controlled_system')),
 source_ref text CHECK(source_ref IS NULL OR length(btrim(source_ref)) BETWEEN 1 AND 160),
 supersedes_revision_id uuid,
 rationale_summary text CHECK(rationale_summary IS NULL OR length(rationale_summary)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 accepted_at timestamptz,
 UNIQUE(plan_id,revision_number),
 UNIQUE(id,plan_id,user_id),
 CHECK (
   (calendar_start_date IS NULL AND calendar_end_date IS NULL AND calendar_timezone IS NULL)
   OR (calendar_start_date IS NOT NULL AND calendar_end_date IS NOT NULL
       AND calendar_timezone IS NOT NULL AND calendar_start_date<=calendar_end_date)
 ),
 CHECK(status NOT IN ('accepted','superseded','archived')
   OR calendar_start_date IS NOT NULL),

 FOREIGN KEY(plan_id,user_id) REFERENCES public.v2_training_plans(id,user_id),
 CHECK(status<>'accepted' OR accepted_at IS NOT NULL)
);
-- Current plan revision points to that exact athlete/plan, not just any UUID.
ALTER TABLE public.v2_training_plans ADD CONSTRAINT v2_training_current_revision_owner_fk
 FOREIGN KEY(active_revision_id,id,user_id)
 REFERENCES public.v2_training_plan_revisions(id,plan_id,user_id)
 DEFERRABLE INITIALLY IMMEDIATE;
CREATE UNIQUE INDEX v2_training_one_accepted_revision_per_plan
 ON public.v2_training_plan_revisions(plan_id) WHERE status='accepted';

CREATE TABLE public.v2_training_session_slots (
 id uuid PRIMARY KEY,
 plan_id uuid NOT NULL,
 user_id uuid NOT NULL,
 slot_key text NOT NULL CHECK(length(btrim(slot_key)) BETWEEN 1 AND 160),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,slot_key), UNIQUE(id,plan_id,user_id),
 FOREIGN KEY(plan_id,user_id) REFERENCES public.v2_training_plans(id,user_id)
);
CREATE TABLE public.v2_training_revision_days (
 id uuid PRIMARY KEY,
 plan_revision_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 user_id uuid NOT NULL,
 athlete_local_date date NOT NULL,
 timezone text NOT NULL CHECK(length(btrim(timezone)) BETWEEN 1 AND 100),
 day_state text NOT NULL CHECK(
  day_state IN ('planned','rest','recovery','unavailable','race','review_required')
 ),
 phase_key text CHECK(phase_key IS NULL OR length(btrim(phase_key)) BETWEEN 1 AND 100),
 sort_order integer NOT NULL CHECK(sort_order>=0),
 UNIQUE(plan_revision_id,athlete_local_date),
 FOREIGN KEY(plan_revision_id,plan_id,user_id)
  REFERENCES public.v2_training_plan_revisions(id,plan_id,user_id)
);
CREATE TABLE public.v2_training_revision_sessions (
 id uuid PRIMARY KEY,
 plan_revision_id uuid NOT NULL,
 session_slot_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 user_id uuid NOT NULL,
 athlete_local_date date NOT NULL,
 local_start_time time,
 timezone text NOT NULL CHECK(length(btrim(timezone)) BETWEEN 1 AND 100),
 sport text NOT NULL CHECK(
  sport IN ('running','walking','cycling','swimming','strength','hiking','rucking',
            'rowing','elliptical','stair','yoga','mobility','hiit','multisport','other')
 ),
 session_kind text NOT NULL CHECK(length(btrim(session_kind)) BETWEEN 1 AND 100),
 purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 500),
 priority text NOT NULL CHECK(priority IN ('competition','key','supporting','optional')),
 intensity text NOT NULL CHECK(intensity IN ('easy','moderate','hard','unknown')),
 duration_target_seconds integer CHECK(duration_target_seconds IS NULL OR duration_target_seconds>=0),
 intent_schema_version text NOT NULL CHECK(intent_schema_version='session-intent-v1'),
 intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object' AND
                         octet_length(intent::text)<=32768),
 sort_order integer NOT NULL CHECK(sort_order>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_revision_id,session_slot_id),
 UNIQUE(id,user_id),
 FOREIGN KEY(plan_revision_id,plan_id,user_id)
  REFERENCES public.v2_training_plan_revisions(id,plan_id,user_id),
 FOREIGN KEY(session_slot_id,plan_id,user_id)
  REFERENCES public.v2_training_session_slots(id,plan_id,user_id),
 -- A revision's session must belong to an explicit scheduled day.
 FOREIGN KEY(plan_revision_id,athlete_local_date)
  REFERENCES public.v2_training_revision_days(plan_revision_id,athlete_local_date)
);
-- Existing canonical execution links to the exact accepted historical
-- revision-session identity; no separate workout execution store.
ALTER TABLE public.v2_training_session_instances
 ADD CONSTRAINT v2_training_execution_prescription_owner_fk
 FOREIGN KEY(revision_session_id,user_id)
 REFERENCES public.v2_training_revision_sessions(id,user_id);

CREATE INDEX v2_training_plan_owner_status
 ON public.v2_training_plans(user_id,status);
CREATE INDEX v2_training_sessions_date
 ON public.v2_training_revision_sessions(user_id,athlete_local_date,plan_revision_id);
-- Candidate tables are private until reviewed safe reader/writer RPCs.
ALTER TABLE public.v2_training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_session_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_revision_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_revision_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_training_plans FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_training_plan_revisions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_training_session_slots FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_training_revision_days FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_training_revision_sessions FROM PUBLIC,anon,authenticated;
-- This candidate establishes physical identities/constraints only. A service
-- writer must enforce accepted revision immutability, expected plan version,
-- serialized acceptance, and exact Coach preview acceptance before any GRANT.


-- Source 3: V2-TRAINING-IMMUTABLE-REVISION-GUARD-CANDIDATE.sql [Git blob 47dafb20ce3ac1c45fd10d1e47642bb6b3f63747]
-- ALL-246 REVIEW ONLY: protect canonical accepted/superseded plan history.
-- NOT A MIGRATION. Must be reviewed alongside the plan writer and calendar.
-- Server-side triggers protect immutable history even if a trusted writer is
-- accidentally given broad UPDATE privilege later.
CREATE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
DECLARE
 v_old_status text;
 v_new_status text;
BEGIN
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
CREATE TRIGGER v2_guard_training_revision_snapshot
 BEFORE UPDATE OR DELETE ON public.v2_training_plan_revisions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate();
CREATE TRIGGER v2_guard_training_revision_days
 BEFORE INSERT OR UPDATE OR DELETE ON public.v2_training_revision_days
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate();
CREATE TRIGGER v2_guard_training_revision_sessions
 BEFORE INSERT OR UPDATE OR DELETE ON public.v2_training_revision_sessions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
-- Existing plan acceptance remains the ONLY reviewed accepted->superseded
-- transition; direct authenticated UPDATE remains revoked on all tables.


-- Source 4: V2-TRAINING-PLAN-ACCEPTANCE-WRITER-CANDIDATE.sql [Git blob c34d02414e369f9b08afcc7f2be0ddd1df49be05]
-- ALL-246 / ALL-222 REVIEW ONLY: serialized canonical Training plan acceptance.
-- Not a migration or deployed client RPC. No direct app EXECUTE grants.
-- Uses the existing immutable revision/slot/day/session owner candidate.
CREATE TABLE allin_private.v2_training_plan_accept_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 action_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 expected_plan_version bigint NOT NULL CHECK(expected_plan_version>=1),
 result_version bigint NOT NULL CHECK(result_version>expected_plan_version),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,action_id),
 FOREIGN KEY(plan_id,user_id) REFERENCES public.v2_training_plans(id,user_id),
 FOREIGN KEY(revision_id,plan_id,user_id)
  REFERENCES public.v2_training_plan_revisions(id,plan_id,user_id)
);
ALTER TABLE allin_private.v2_training_plan_accept_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_training_plan_accept_receipts
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_training_accept_plan_revision_candidate(
 p_user_id uuid,p_plan_id uuid,p_revision_id uuid,p_action_id uuid,
 p_expected_plan_version bigint
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $accept$
DECLARE
 v_plan public.v2_training_plans%ROWTYPE;
 v_revision public.v2_training_plan_revisions%ROWTYPE;
 v_receipt allin_private.v2_training_plan_accept_receipts%ROWTYPE;
 v_next_version bigint;
 v_first_day date;
 v_last_day date;
 v_day_count bigint;
BEGIN
 IF p_user_id IS NULL OR p_plan_id IS NULL OR p_revision_id IS NULL
    OR p_action_id IS NULL OR p_expected_plan_version IS NULL
    OR p_expected_plan_version<1 THEN
    RAISE EXCEPTION 'Invalid plan acceptance request' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-plan:'||p_user_id::text,0));
 SELECT * INTO v_receipt FROM allin_private.v2_training_plan_accept_receipts
   WHERE user_id=p_user_id AND action_id=p_action_id;
 IF FOUND THEN
   IF v_receipt.plan_id<>p_plan_id OR v_receipt.revision_id<>p_revision_id OR
      v_receipt.expected_plan_version<>p_expected_plan_version THEN
     RAISE EXCEPTION 'Conflicting plan acceptance replay' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('planId',p_plan_id,
      'revisionId',p_revision_id,'version',v_receipt.result_version,'replayed',true);
 END IF;
 SELECT * INTO v_plan FROM public.v2_training_plans
   WHERE id=p_plan_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan owner mismatch' USING ERRCODE='42501'; END IF;
 IF v_plan.status IN ('archived','completed') THEN
    RAISE EXCEPTION 'Terminal plan cannot be changed' USING ERRCODE='22023'; END IF;
 IF v_plan.version<>p_expected_plan_version THEN
    RAISE EXCEPTION 'Plan version changed, reload before acceptance' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_revision FROM public.v2_training_plan_revisions
   WHERE id=p_revision_id AND plan_id=p_plan_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR v_revision.status<>'candidate' THEN
    RAISE EXCEPTION 'Only same-owner candidate revision can be accepted'
     USING ERRCODE='22023'; END IF;
 -- The date window is athlete-approved revision intent, NOT inferred from
 -- submitted child days or from an optional Goal deadline. Candidates can be
 -- incomplete while editing; accepted revisions require explicit bounds.
 IF v_revision.calendar_start_date IS NULL
    OR v_revision.calendar_end_date IS NULL
    OR v_revision.calendar_timezone IS NULL THEN
   RAISE EXCEPTION 'Accepted calendar requires explicit start/end/timezone'
     USING ERRCODE='22023';
 END IF;
 -- A matching arbitrary string is not a usable timezone. Accept only
 -- database-recognized named zones; do not silently normalize a typo or
 -- reinterpret an existing athlete-local day using the server timezone.
 IF NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_timezone_names tz
   WHERE tz.name=v_revision.calendar_timezone
 ) THEN
   RAISE EXCEPTION 'Calendar timezone is not a recognized named zone'
     USING ERRCODE='22023';
 END IF;
 -- A calendar revision may consist of explicitly planned rest/unavailable days,
 -- but it cannot be an empty AI-generated shell.
 IF NOT EXISTS(SELECT 1 FROM public.v2_training_revision_days
    WHERE plan_revision_id=p_revision_id AND plan_id=p_plan_id AND user_id=p_user_id)
 THEN RAISE EXCEPTION 'Cannot accept a revision without explicit day state'
     USING ERRCODE='22023'; END IF;
 -- Count every date in the athlete-reviewed inclusive revision window.
 -- The per-revision unique date key makes count + exact min/max sufficient
 -- to reject missing first, interior or last days. Event date/course source
 -- certification is separately required from the Goal/Event owner.
 SELECT min(athlete_local_date),max(athlete_local_date),count(*)
 INTO v_first_day,v_last_day,v_day_count
 FROM public.v2_training_revision_days
 WHERE plan_revision_id=p_revision_id AND plan_id=p_plan_id
   AND user_id=p_user_id;
 IF v_first_day IS DISTINCT FROM v_revision.calendar_start_date
    OR v_last_day IS DISTINCT FROM v_revision.calendar_end_date
    OR v_day_count<>(v_revision.calendar_end_date-v_revision.calendar_start_date+1)::bigint
 THEN
   RAISE EXCEPTION 'Candidate calendar has missing coverage or wrong approved boundaries'
     USING ERRCODE='22023';
 END IF;
 IF EXISTS(
   SELECT 1 FROM public.v2_training_revision_days d
   WHERE d.plan_revision_id=p_revision_id AND d.user_id=p_user_id
     AND d.timezone IS DISTINCT FROM v_revision.calendar_timezone
 ) THEN
   RAISE EXCEPTION 'Calendar day timezone differs from reviewed revision'
     USING ERRCODE='22023';
 END IF;
 -- A candidate calendar cannot schedule a workout on a declared rest or
 -- unavailable day. Also reject timezone drift between the canonical day and
 -- its session; otherwise Today and activity date projections can disagree.
 IF EXISTS (
   SELECT 1 FROM public.v2_training_revision_sessions s
   JOIN public.v2_training_revision_days d
     ON d.plan_revision_id=s.plan_revision_id
       AND d.athlete_local_date=s.athlete_local_date
   WHERE s.plan_revision_id=p_revision_id
     AND s.plan_id=p_plan_id AND s.user_id=p_user_id
     AND (d.day_state IN ('rest','unavailable')
          OR d.timezone IS DISTINCT FROM s.timezone)
 ) THEN
   RAISE EXCEPTION 'Candidate calendar contradicts scheduled workout day'
     USING ERRCODE='22023';
 END IF;
 -- Existing active prescription is preserved, only status becomes superseded.
 UPDATE public.v2_training_plan_revisions
  SET status='superseded'
  WHERE id=v_plan.active_revision_id AND plan_id=p_plan_id
    AND user_id=p_user_id AND status='accepted';
 UPDATE public.v2_training_plan_revisions
  SET status='accepted',accepted_at=now(),reviewed_at=now()
  WHERE id=p_revision_id AND plan_id=p_plan_id AND user_id=p_user_id AND status='candidate';
 IF NOT FOUND THEN RAISE EXCEPTION 'Candidate revision changed' USING ERRCODE='40001'; END IF;
 v_next_version:=v_plan.version+1;
 UPDATE public.v2_training_plans
  SET active_revision_id=p_revision_id,status='active',
      version=v_next_version,updated_at=now()
  WHERE id=p_plan_id AND user_id=p_user_id AND version=p_expected_plan_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan acceptance race' USING ERRCODE='40001'; END IF;
 INSERT INTO allin_private.v2_training_plan_accept_receipts
   (user_id,action_id,plan_id,revision_id,expected_plan_version,result_version)
 VALUES(p_user_id,p_action_id,p_plan_id,p_revision_id,p_expected_plan_version,v_next_version);
 RETURN pg_catalog.jsonb_build_object('planId',p_plan_id,
    'revisionId',p_revision_id,'version',v_next_version,'replayed',false);
END;
$accept$;
REVOKE ALL ON FUNCTION allin_private.v2_training_accept_plan_revision_candidate(
 uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- The final authenticated owner API must verify actual account + auth.sessions,
-- expected version, and explicit athlete acceptance before calling this helper.
-- Immutability enforcement for approved revision children still requires a
-- service-owned mutation trigger/policy before production migration.


-- Source 5: V2-TRAINING-SESSION-LIFECYCLE-WRITER-CANDIDATE.sql [Git blob 42e0ab60db7172f34f1903acb2a037decdfa30e6]
-- ALL-246 / ALL-243 REVIEW ONLY: canonical Training lifecycle and completion outbox.
-- NOT A MIGRATION. NOT a client RPC. No V2 hosted deployment.
-- This extends the existing owner identity candidate; no new workout table.
-- Private, invoker-only service contract; do not expose to authenticated users.
CREATE TABLE allin_private.v2_training_action_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  session_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN ('start','pause','resume','finish','cancel')),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint)=64
    AND request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_version bigint NOT NULL CHECK (result_version>=1),
  result_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,action_id),
  FOREIGN KEY(session_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id)
);
CREATE TABLE public.v2_training_execution_events (
  id uuid PRIMARY KEY,
  session_instance_id uuid NOT NULL,
  user_id uuid NOT NULL,
  sequence_number bigint NOT NULL CHECK(sequence_number>=1),
  event_type text NOT NULL CHECK(event_type IN ('start','pause','resume','finish','cancel')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_action_id uuid NOT NULL,
  event_schema_version text NOT NULL DEFAULT 'session-v1'
    CHECK(event_schema_version='session-v1'),
  UNIQUE(session_instance_id,sequence_number),
  UNIQUE(user_id,client_action_id),
  FOREIGN KEY(session_instance_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id)
);
CREATE TABLE allin_private.v2_training_completion_outbox (
  session_instance_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  action_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  FOREIGN KEY(session_instance_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id),
  UNIQUE(user_id,action_id)
);
ALTER TABLE allin_private.v2_training_action_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_training_completion_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_training_action_receipts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.v2_training_execution_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_training_completion_outbox FROM PUBLIC,anon,authenticated,service_role;

-- This function has NO client privilege, and does not claim client authorization.
-- It is invoked ONLY by a future owner-reviewed trusted server action that
-- authenticates the actual actor, checks account/session and supplies owner.
-- It cannot itself be offered as a public mutation endpoint.
CREATE FUNCTION allin_private.v2_training_apply_session_candidate(
 p_user_id uuid,p_session_id uuid,p_action_id uuid,p_command text,
 p_expected_version bigint,p_request_fingerprint text,
 p_local_date date,p_timezone text,p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $writer$
DECLARE
 v_session public.v2_training_session_instances%ROWTYPE;
 v_receipt allin_private.v2_training_action_receipts%ROWTYPE;
 v_next_status text;
 v_next_version bigint;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_action_id IS NULL
    OR p_occurred_at IS NULL OR p_command NOT IN ('start','pause','resume','finish','cancel')
    OR p_command IS NULL OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid canonical session action' USING ERRCODE='22023'; END IF;
 -- All action IDs for the same owner are serialized before receipt check.
 -- Prevents two concurrent first-time actions from racing the same session.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(p_user_id::text,0)
 );
 SELECT * INTO v_receipt FROM allin_private.v2_training_action_receipts
   WHERE user_id=p_user_id AND action_id=p_action_id;
 IF FOUND THEN
   IF v_receipt.session_id<>p_session_id OR v_receipt.command<>p_command OR
      v_receipt.request_fingerprint<>p_request_fingerprint
   THEN RAISE EXCEPTION 'Conflicting canonical action replay' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('sessionId',p_session_id,
      'version',v_receipt.result_version,'status',v_receipt.result_status,'replayed',true);
 END IF;
 IF p_command='start' THEN
   IF p_expected_version<>0 OR p_local_date IS NULL OR p_timezone IS NULL
      OR length(pg_catalog.btrim(p_timezone))=0
   THEN RAISE EXCEPTION 'Invalid start expected version or date' USING ERRCODE='22023'; END IF;
   INSERT INTO public.v2_training_session_instances
    (id,user_id,status,source_kind,athlete_local_date,timezone,started_at)
   VALUES(p_session_id,p_user_id,'active','phone',p_local_date,p_timezone,p_occurred_at);
   v_next_status:='active'; v_next_version:=1;
 ELSE
   SELECT * INTO v_session FROM public.v2_training_session_instances
    WHERE id=p_session_id AND user_id=p_user_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Session owner mismatch or not found' USING ERRCODE='42501'; END IF;
   IF p_expected_version IS DISTINCT FROM v_session.version THEN
      RAISE EXCEPTION 'Stale canonical session version' USING ERRCODE='40001'; END IF;
   v_next_status:=CASE
    WHEN p_command='pause' AND v_session.status='active' THEN 'paused'
    WHEN p_command='resume' AND v_session.status='paused' THEN 'active'
    WHEN p_command='finish' AND v_session.status IN ('active','paused') THEN 'completed'
    WHEN p_command='cancel' AND v_session.status IN ('active','paused') THEN 'cancelled'
    ELSE NULL END;
   IF v_next_status IS NULL THEN
      RAISE EXCEPTION 'Illegal session lifecycle transition' USING ERRCODE='22023'; END IF;
   v_next_version:=v_session.version+1;
   UPDATE public.v2_training_session_instances
    SET status=v_next_status,version=v_next_version,
        last_event_sequence=v_next_version,
        finished_at=CASE WHEN v_next_status IN ('completed','cancelled') THEN p_occurred_at ELSE NULL END,
        updated_at=now()
    WHERE id=p_session_id AND user_id=p_user_id;
 END IF;
 IF p_command='start' THEN
   UPDATE public.v2_training_session_instances SET last_event_sequence=1 WHERE id=p_session_id;
 END IF;
 INSERT INTO public.v2_training_execution_events
   (id,session_instance_id,user_id,sequence_number,event_type,occurred_at,client_action_id)
 VALUES(p_action_id,p_session_id,p_user_id,v_next_version,p_command,p_occurred_at,p_action_id);
 IF p_command='finish' THEN
   INSERT INTO allin_private.v2_training_completion_outbox
    (session_instance_id,user_id,action_id)
   VALUES(p_session_id,p_user_id,p_action_id);
 END IF;
 INSERT INTO allin_private.v2_training_action_receipts
   (user_id,action_id,session_id,command,request_fingerprint,result_version,result_status)
 VALUES(p_user_id,p_action_id,p_session_id,p_command,p_request_fingerprint,v_next_version,v_next_status);
 RETURN pg_catalog.jsonb_build_object('sessionId',p_session_id,
     'version',v_next_version,'status',v_next_status,'replayed',false);
END;
$writer$;
REVOKE ALL ON FUNCTION allin_private.v2_training_apply_session_candidate(
 uuid,uuid,uuid,text,bigint,text,date,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
-- No user-facing function GRANT, trigger, workout creation or outbox worker.


-- Source 6: V2-TRAINING-AUTH-OWNER-GATEWAY-CANDIDATE.sql [Git blob 499dd9ad0743705718b30adb7cea473b192fc426]
-- ALL-246 / ALL-222 REVIEW-ONLY authenticated owner gateway for Training actions.
-- NOT A MIGRATION. No live grants or deployment authorized.
-- Uses existing V2 auth.uid / auth.users / v2_profiles identity. It delegates to
-- exactly ONE owner writer; no extra workout/session store.
-- This proposal deliberately requires an existing auth.sessions row; the
-- session_id claim must be issued by trusted Supabase Auth, never user metadata.
CREATE FUNCTION public.v2_training_session_action_candidate(
 p_expected_user_id uuid,p_session_id uuid,p_action_id uuid,p_command text,
 p_expected_version bigint,p_request_fingerprint text,
 p_local_date date,p_timezone text,p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $owner_action$
DECLARE
 v_uid uuid := auth.uid();
 v_session_claim text := pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session_id uuid;
 v_server_fingerprint text;
BEGIN
 IF v_uid IS NULL OR p_expected_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Expected owner does not match authenticated account'
      USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=v_uid)
    OR NOT EXISTS (SELECT 1 FROM public.v2_profiles p WHERE p.user_id=v_uid)
 THEN RAISE EXCEPTION 'Active V2 account required' USING ERRCODE='42501'; END IF;
 -- Fail closed on missing/malformed session_id rather than silently trusting
 -- a stale Auth JWT after account/session revocation.
 IF v_session_claim IS NULL OR v_session_claim='' THEN
   RAISE EXCEPTION 'Active authenticated session required' USING ERRCODE='42501';
 END IF;
 BEGIN
   v_session_id:=v_session_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'Invalid authenticated session identifier' USING ERRCODE='42501';
 END;
 IF NOT EXISTS (SELECT 1 FROM auth.sessions s
    WHERE s.id=v_session_id AND s.user_id=v_uid
      AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())) THEN
   RAISE EXCEPTION 'Authenticated session expired or revoked' USING ERRCODE='42501';
 END IF;
 IF p_expected_version IS NULL OR p_expected_version<0 THEN
   RAISE EXCEPTION 'Expected session version is required' USING ERRCODE='22023';
 END IF;
 -- Derive the exact retry identity on the server, not from a client
 -- supplied opaque hash. A reused action ID with changed request fields must
 -- fail, not misleadingly report success for a different command payload.
 v_server_fingerprint:=pg_catalog.encode(pg_catalog.sha256(
   pg_catalog.convert_to(
     pg_catalog.jsonb_build_array(p_session_id,p_command,p_expected_version,
       p_local_date,p_timezone,p_occurred_at)::text,'UTF8')
   ),'hex');
 RETURN allin_private.v2_training_apply_session_candidate(
   v_uid,p_session_id,p_action_id,p_command,p_expected_version,
   v_server_fingerprint,p_local_date,p_timezone,p_occurred_at
 );
END;
$owner_action$;
REVOKE ALL ON FUNCTION public.v2_training_session_action_candidate(
 uuid,uuid,uuid,text,bigint,text,date,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit review gate: the final migration must separately approve
-- GRANT EXECUTE TO authenticated after real-session & two-user replay.
-- This file intentionally contains NO execute grant.

