-- ALL-239 / ALL-222: REVIEW-ONLY canonical Goals identity + immutable revision keys.
-- NOT A VERSIONED MIGRATION. DO NOT DEPLOY to hosted V2.
-- Builds on auth.users. Training/Completed Activity/EventHub remain separate owners.
-- No Goal writer, client grants, metric catalog, Event table or automatic plan.
BEGIN;

CREATE TABLE public.v2_goals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_kind text NOT NULL CHECK (
    goal_kind IN ('race_event','strength_performance','endurance_distance',
    'endurance_time','sport_benchmark','machine_capacity','nutrition_habit',
    'activity_habit','body_composition','general_wellbeing','exploratory_intention')
  ),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR length(description)<=3000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','completed','abandoned','archived')),
  active_revision_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id)
);
CREATE TABLE public.v2_goal_revisions (
  id uuid PRIMARY KEY,
  goal_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK(revision_number>=1),
  status text NOT NULL DEFAULT 'candidate'
    CHECK(status IN ('candidate','accepted','superseded','rejected','archived')),
  source_kind text NOT NULL
    CHECK(source_kind IN ('athlete_authored','coach_proposal','import_review','controlled_system')),
  priority_role text NOT NULL DEFAULT 'optional'
    CHECK(priority_role IN ('primary','secondary','maintenance','optional')),
  priority_order integer CHECK(priority_order IS NULL OR priority_order>=0),
  start_date date,
  target_date date,
  check_in_date date,
  timezone text CHECK(timezone IS NULL OR length(btrim(timezone)) BETWEEN 1 AND 100),
  goal_schema_version text NOT NULL DEFAULT 'v1'
    CHECK(length(btrim(goal_schema_version)) BETWEEN 1 AND 40),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(goal_id,revision_number),
  UNIQUE(id,goal_id,user_id),
  FOREIGN KEY(goal_id,user_id) REFERENCES public.v2_goals(id,user_id) ON DELETE CASCADE,
  CONSTRAINT v2_goal_revision_date_order CHECK(
    start_date IS NULL OR target_date IS NULL OR start_date<=target_date),
  CONSTRAINT v2_goal_revision_accepted_at CHECK(
    (status='accepted' AND accepted_at IS NOT NULL)
    OR (status<>'accepted'))
);
-- Only one currently accepted revision per distinct goal.
-- There is deliberately NO one-primary-goal-per-athlete constraint.
CREATE UNIQUE INDEX v2_goal_single_current_revision
  ON public.v2_goal_revisions(goal_id) WHERE status='accepted';
ALTER TABLE public.v2_goals
  ADD CONSTRAINT v2_goal_active_revision_same_owner_fk
  FOREIGN KEY(active_revision_id,id,user_id)
  REFERENCES public.v2_goal_revisions(id,goal_id,user_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_goals_by_owner ON public.v2_goals(user_id,status);
CREATE INDEX v2_goal_revisions_by_owner ON public.v2_goal_revisions(user_id,goal_id);

-- No authenticated client rights or policy until the canonical Goal owner
-- approves expected-version CAS, idempotency and explicit user acceptance.
ALTER TABLE public.v2_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_goal_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_goals,public.v2_goal_revisions
  FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.v2_goals IS
 'ALL-239 review-only: canonical stable Goal owner, not a deployed application table';
COMMENT ON TABLE public.v2_goal_revisions IS
 'ALL-239 review-only: versioned Goal priority/target intent; writer not yet approved';
COMMIT;
