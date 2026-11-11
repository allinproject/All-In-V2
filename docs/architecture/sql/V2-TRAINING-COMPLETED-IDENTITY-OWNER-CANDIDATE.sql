-- ALL-222 / ALL-243 / ALL-246 REVIEW-ONLY CANONICAL WORKOUT OWNER FOUNDATION
-- NOT A MIGRATION. NOT AUTHORIZED FOR LIVE V2 DEPLOYMENT.
-- This is the narrow shared identity slice, not full Training plan/metric schemas.
-- Any live writer, RLS read grant or migration requires owner approval.
-- V2 user/account identity is auth.users(id); no imported V1 personal records.
BEGIN;

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
  source_record_id text NOT NULL CHECK (length(source_record_id) BETWEEN 1 AND 500),
  source_revision text,
  source_device_ref text,
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
COMMIT;
