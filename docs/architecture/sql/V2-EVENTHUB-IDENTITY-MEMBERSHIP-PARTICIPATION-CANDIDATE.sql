-- ALL-244 / ALL-222 / ALL-246: REVIEW-ONLY canonical all-sport EventHub identity.
-- NOT a migration or public API. No event directory, automatic joining,
-- athlete registration or result verification is introduced.
-- URL match, DNS/redirect/SSRF validation, organizer verification and
-- participation evidence MUST be implemented by the owning service.
BEGIN;
CREATE TABLE public.v2_events (
 id uuid PRIMARY KEY,
 event_version bigint NOT NULL DEFAULT 1 CHECK (event_version>=1),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 sport text NOT NULL CHECK (length(btrim(sport)) BETWEEN 1 AND 80),
 event_kind text NOT NULL CHECK (length(btrim(event_kind)) BETWEEN 1 AND 100),
 organizer_name text CHECK (organizer_name IS NULL OR length(organizer_name)<=200),
 start_local_date date,
 event_timezone text CHECK (event_timezone IS NULL OR
   length(btrim(event_timezone)) BETWEEN 1 AND 100),
 source_verification text NOT NULL DEFAULT 'unverified'
   CHECK(source_verification IN ('unverified','athlete_submitted','organizer_verified')),
 source_revision text CHECK(source_revision IS NULL OR length(source_revision)<=160),
 cancelled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v2_event_verified_date_timezone CHECK(
   source_verification<>'organizer_verified'
   OR (start_local_date IS NOT NULL AND event_timezone IS NOT NULL)),
 UNIQUE(id,event_version)
);
CREATE TABLE public.v2_event_url_aliases (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES public.v2_events(id) ON DELETE CASCADE,
 canonical_url text NOT NULL CHECK(length(canonical_url) BETWEEN 12 AND 2048),
 evidence_kind text NOT NULL CHECK(evidence_kind IN
  ('submitted','organizer_verified','redirect_reviewed')),
 source_checked_at timestamptz,
 -- Server grants a URL to ONE exact event only after identity review.
 UNIQUE(canonical_url)
);
CREATE TABLE public.v2_event_groups (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL UNIQUE REFERENCES public.v2_events(id) ON DELETE CASCADE,
 group_version bigint NOT NULL DEFAULT 1 CHECK(group_version>=1),
 state text NOT NULL DEFAULT 'pending'
   CHECK(state IN ('pending','active','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,event_id)
);
CREATE TABLE public.v2_event_group_memberships (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES public.v2_events(id) ON DELETE CASCADE,
 group_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'not_joined'
   CHECK(state IN ('not_joined','joined','left')),
 participant_visible boolean NOT NULL DEFAULT false,
 joined_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version>=1),
 PRIMARY KEY(user_id,group_id),
 FOREIGN KEY(group_id,event_id)
   REFERENCES public.v2_event_groups(id,event_id) ON DELETE CASCADE,
 CONSTRAINT v2_event_membership_visibility CHECK(
   (state='joined' AND joined_at IS NOT NULL)
   OR (state<>'joined' AND joined_at IS NULL AND NOT participant_visible))
);
CREATE INDEX v2_event_member_by_account
  ON public.v2_event_group_memberships(user_id,event_id,state);

-- This identity exists INDEPENDENTLY of EventHub group membership.
-- A joined EventHub group is not race registration or a verified result.
CREATE TABLE public.v2_event_participations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES public.v2_events(id) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN
  ('interested','registered','attended','completed','withdrawn')),
 source_kind text NOT NULL CHECK(source_kind IN
  ('athlete_confirmed','organizer_verified')),
 source_note text CHECK (source_note IS NULL OR length(source_note)<=500),
 result_verified boolean NOT NULL DEFAULT false,
 result_source_revision text,
 version bigint NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,event_id),
 CONSTRAINT v2_event_result_evidence CHECK(
   NOT result_verified OR
   (state='completed' AND source_kind='organizer_verified'
     AND result_source_revision IS NOT NULL
     AND length(btrim(result_source_revision)) BETWEEN 1 AND 160))
);
CREATE INDEX v2_event_participation_by_account
  ON public.v2_event_participations(user_id,state);

-- RLS and ALL permissions closed until one reviewed canonical writer/reader.
ALTER TABLE public.v2_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_event_url_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_event_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_event_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_event_participations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_events,public.v2_event_url_aliases,
 public.v2_event_groups,public.v2_event_group_memberships,
 public.v2_event_participations FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.v2_event_participations IS
 'ALL-244 review-only: independent athlete event participation, never implied by EventHub group join';
COMMENT ON TABLE public.v2_event_url_aliases IS
 'ALL-244 review-only: one alias to one verified exact event after backend URL provenance/SSRF review';
COMMIT;
