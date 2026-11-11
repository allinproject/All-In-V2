-- ALL-253 / ALL-222 REVIEW-ONLY V2 WEEKLY INDOOR COMPETITION OWNER CANDIDATE.
-- NOT A MIGRATION. DO NOT APPLY TO HOSTED V2 OR ENABLE SCHEDULED PUBLICATION.
-- Depends on approved ALL-243 public.v2_completed_activities(id,user_id) unique
-- owner pair, and ALL-245 certified cycling power/source evidence. NO V1 data port.
-- All mutations must occur through future service-owned audited writer/worker.
-- The SQL below is intentionally a candidate and omits activation RPC/cron.
BEGIN;

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
COMMIT;
