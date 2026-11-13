-- ALL-239 / ALL-244 / ALL-246: review-only typed Goal-to-Event link.
-- Apply only in an isolated review database AFTER both canonical Goal and Event
-- identity candidates. NOT a migration, grant, or authority to auto-accept goals.
-- Goal owner must write links only after explicit athlete acceptance and
-- current revision/CAS checks. EventHub group membership never creates a link.
CREATE TABLE public.v2_goal_event_edition_links (
 goal_id uuid NOT NULL,
 goal_revision_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 event_id uuid NOT NULL,
 edition_id uuid NOT NULL,
 event_version bigint NOT NULL CHECK(event_version>=1),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 PRIMARY KEY(goal_revision_id),
 FOREIGN KEY(goal_revision_id,goal_id,user_id)
   REFERENCES public.v2_goal_revisions(id,goal_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,edition_id)
   REFERENCES public.v2_events(id,edition_id) ON DELETE RESTRICT
);
CREATE INDEX v2_goal_event_edition_links_by_owner
 ON public.v2_goal_event_edition_links(user_id,event_id,edition_id);
-- There is deliberately NO unique(user_id,priority_role='primary') rule:
-- distinct accepted goals may target multiple primary events simultaneously.
-- Actual acceptance/current active revision checks belong to the canonical
-- Goal owner transaction and authoritative reader; FKs alone are not enough.
ALTER TABLE public.v2_goal_event_edition_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_goal_event_edition_links
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.v2_goal_event_edition_links IS
 'ALL-239 review-only Goal-owned exact accepted revision to canonical Event edition binding; no client writes or inferred registration';
