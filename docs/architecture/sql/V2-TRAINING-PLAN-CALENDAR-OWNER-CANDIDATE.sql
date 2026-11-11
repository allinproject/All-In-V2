-- ALL-222/246 REVIEW ONLY, canonical Training plan/calendar ownership candidate.
-- NOT a migration, NO app grants, NO live deployment. Builds on the existing
-- V2-TRAINING-COMPLETED-IDENTITY-OWNER-CANDIDATE.sql. No duplicate calendar.
-- Coach may propose revisions but cannot mutate accepted plans directly.
BEGIN;
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
  sport IN ('running','cycling','swimming','strength','hiking','rucking',
            'rowing','elliptical','stair','yoga','mobility','other')
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
COMMIT;
