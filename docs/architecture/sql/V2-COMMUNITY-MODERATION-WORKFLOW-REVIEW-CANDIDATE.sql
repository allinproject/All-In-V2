-- ALL-244 / ALL-251 REVIEW ONLY. Extends the existing canonical Community
-- post/comment source; no parallel feed, moderation app or Data API grants.
-- NOT a migration. Do not install/activate until legal purpose/retention,
-- reviewer provisioning, abuse limits, mobile flows and Auth acceptance.
-- Requires V2-COMMUNITY-CANONICAL-POSTS-OWNER-CANDIDATE.sql.
--
-- A user can never create a reviewer grant through an authenticated RPC.
-- Privileged operators provision/revoke these rows externally under a
-- separately audited access-control workflow; no reviewer API grants here.
CREATE TABLE allin_private.v2_community_moderator_grants (
 reviewer_id uuid NOT NULL REFERENCES public.v2_profiles(user_id) ON DELETE CASCADE,
 permission text NOT NULL CHECK(permission IN ('initial_review','appeal_review')),
 enabled boolean NOT NULL DEFAULT false,
 assigned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(reviewer_id,permission)
);
CREATE TABLE allin_private.v2_community_moderation_reports (
 id uuid PRIMARY KEY,
 comment_id uuid NOT NULL REFERENCES allin_private.v2_community_comments(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES public.v2_profiles(user_id) ON DELETE CASCADE,
 reason_code text NOT NULL CHECK(reason_code IN ('spam','harassment','privacy','other')),
 reason_detail text NOT NULL DEFAULT '' CHECK(length(reason_detail)<=500),
 status text NOT NULL DEFAULT 'reported'
   CHECK(status IN ('reported','decided','appealed','closed')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 initial_reviewer_id uuid REFERENCES public.v2_profiles(user_id) ON DELETE SET NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 CONSTRAINT v2_community_moderation_one_report_per_reporter
   UNIQUE(reporter_id,comment_id)
);
CREATE INDEX v2_community_moderation_report_queue
 ON allin_private.v2_community_moderation_reports(status,submitted_at,id);
CREATE TABLE allin_private.v2_community_moderation_appeals (
 report_id uuid PRIMARY KEY REFERENCES allin_private.v2_community_moderation_reports(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES public.v2_profiles(user_id) ON DELETE CASCADE,
 statement text NOT NULL CHECK(length(btrim(statement)) BETWEEN 1 AND 1000),
 submitted_at timestamptz NOT NULL DEFAULT now()
);
-- Append-only by contract; no client/ordinary service DML. The one existing
-- moderation lifecycle owns this audit trail and its retention/legal holds.
CREATE TABLE allin_private.v2_community_moderation_events (
 report_id uuid NOT NULL REFERENCES allin_private.v2_community_moderation_reports(id) ON DELETE CASCADE,
 version bigint NOT NULL CHECK(version>0),
 actor_id uuid NOT NULL REFERENCES public.v2_profiles(user_id) ON DELETE CASCADE,
 event_kind text NOT NULL CHECK(event_kind IN
   ('reported','initial_decision','appealed','appeal_decision')),
 result_code text NOT NULL CHECK(length(result_code) BETWEEN 1 AND 40),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(report_id,version)
);
DO $secure_moderation$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.oid,c.relname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='allin_private' AND c.relname IN (
   'v2_community_moderator_grants',
   'v2_community_moderation_reports',
   'v2_community_moderation_appeals',
   'v2_community_moderation_events')
 LOOP
  EXECUTE pg_catalog.format('ALTER TABLE allin_private.%I ENABLE ROW LEVEL SECURITY',r.relname);
  EXECUTE pg_catalog.format('REVOKE ALL ON TABLE allin_private.%I FROM PUBLIC,anon,authenticated,service_role',r.relname);
 END LOOP;
END $secure_moderation$;

-- Actor must have a live Auth session, not merely an unexpired, possibly
-- revoked JWT. The CI fixture populates auth.sessions with disposable IDs.
CREATE OR REPLACE FUNCTION allin_private.v2_community_moderation_actor()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $actor$
DECLARE
 v_actor uuid:=auth.uid();
 v_session text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
BEGIN
 IF v_actor IS NULL OR v_session IS NULL OR v_session='' OR
  NOT EXISTS(
   SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
    JOIN public.v2_profiles p ON p.user_id=u.id
    WHERE u.id=v_actor AND s.id::text=v_session)
 THEN RAISE EXCEPTION 'community_moderation_session_unavailable'
   USING ERRCODE='42501'; END IF;
 RETURN v_actor;
END;
$actor$;
REVOKE ALL ON FUNCTION allin_private.v2_community_moderation_actor()
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION allin_private.v2_community_moderation_reviewer(
 p_permission text
) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $reviewer$
DECLARE v_actor uuid;
BEGIN
 v_actor:=allin_private.v2_community_moderation_actor();
 IF NOT EXISTS(SELECT 1 FROM allin_private.v2_community_moderator_grants g
   WHERE g.reviewer_id=v_actor AND g.permission=p_permission AND g.enabled)
 THEN RAISE EXCEPTION 'community_moderation_reviewer_not_authorized'
  USING ERRCODE='42501'; END IF;
 RETURN v_actor;
END;
$reviewer$;
REVOKE ALL ON FUNCTION allin_private.v2_community_moderation_reviewer(text)
 FROM PUBLIC,anon,authenticated,service_role;

-- A report does not copy potentially sensitive comment bytes into audit.
-- The reporter must currently be allowed to view the parent post and must
-- not be blocked by its owner. This is NOT a report-content disclosure API.
CREATE OR REPLACE FUNCTION allin_private.v2_community_report_comment(
 p_report_id uuid,p_comment_id uuid,p_reason_code text,p_reason_detail text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $report$
DECLARE v_actor uuid;v_row allin_private.v2_community_moderation_reports%ROWTYPE;
 v_comment allin_private.v2_community_comments%ROWTYPE;
 v_post allin_private.v2_community_posts%ROWTYPE;
 v_allowed boolean;
BEGIN
 v_actor:=allin_private.v2_community_moderation_actor();
 IF p_report_id IS NULL OR p_comment_id IS NULL OR p_reason_code NOT IN
   ('spam','harassment','privacy','other') OR p_reason_code IS NULL OR
   p_reason_detail IS NULL OR length(p_reason_detail)>500
 THEN RAISE EXCEPTION 'invalid_community_report' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_comment FROM allin_private.v2_community_comments
  WHERE id=p_comment_id AND deleted_at IS NULL FOR SHARE;
 IF v_comment.id IS NULL OR v_comment.author_id=v_actor
    OR v_comment.moderation_state<>'visible'
    OR EXISTS(SELECT 1 FROM allin_private.v2_community_blocks b
      WHERE (b.blocker_id=v_actor AND b.blocked_id=v_comment.author_id)
         OR (b.blocker_id=v_comment.author_id AND b.blocked_id=v_actor))
 THEN RAISE EXCEPTION 'community_report_target_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_post FROM allin_private.v2_community_posts
  WHERE id=v_comment.post_id FOR SHARE;
 IF v_post.id IS NULL OR EXISTS(
   SELECT 1 FROM allin_private.v2_community_blocks b WHERE
   (b.blocker_id=v_actor AND b.blocked_id=v_post.owner_id) OR
   (b.blocker_id=v_post.owner_id AND b.blocked_id=v_actor))
 THEN RAISE EXCEPTION 'community_report_target_unavailable' USING ERRCODE='42501'; END IF;
 SELECT v_actor=v_post.owner_id OR
  (v_post.audience<>'private' AND (
   EXISTS(SELECT 1 FROM allin_private.v2_community_follows f
    WHERE f.follower_id=v_actor AND f.followed_id=v_post.owner_id
      AND f.state='approved')
   OR (v_post.audience='public' AND COALESCE(
    (SELECT profile_visibility FROM allin_private.v2_community_visibility
      WHERE user_id=v_post.owner_id),'private')='public')))
 INTO v_allowed;
 IF NOT v_allowed THEN
  RAISE EXCEPTION 'community_report_target_unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_community_moderation_reports
  (id,comment_id,reporter_id,reason_code,reason_detail)
 VALUES(p_report_id,p_comment_id,v_actor,p_reason_code,p_reason_detail)
 ON CONFLICT(id) DO NOTHING;
 SELECT * INTO v_row FROM allin_private.v2_community_moderation_reports
  WHERE id=p_report_id FOR UPDATE;
 IF v_row.reporter_id IS DISTINCT FROM v_actor OR
  v_row.comment_id IS DISTINCT FROM p_comment_id OR
  v_row.reason_code IS DISTINCT FROM p_reason_code OR
  v_row.reason_detail IS DISTINCT FROM p_reason_detail
 THEN RAISE EXCEPTION 'community_report_id_conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO allin_private.v2_community_moderation_events
  (report_id,version,actor_id,event_kind,result_code)
 VALUES(p_report_id,1,v_actor,'reported',p_reason_code)
 ON CONFLICT(report_id,version) DO NOTHING;
 RETURN pg_catalog.jsonb_build_object('reportId',p_report_id,'status',v_row.status);
END;
$report$;
REVOKE ALL ON FUNCTION allin_private.v2_community_report_comment(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- A comment can have more than one reporter/case. No dismiss or appeal
-- may accidentally clear another case's live hide/hold. Called while the
-- canonical comment row is already FOR UPDATE locked by trusted decisions.
CREATE OR REPLACE FUNCTION allin_private.v2_community_refresh_moderation_state(
 p_comment_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $refresh$
DECLARE v_state text;
BEGIN
 SELECT CASE
  WHEN EXISTS(
   SELECT 1 FROM allin_private.v2_community_moderation_reports r
   JOIN allin_private.v2_community_moderation_events d
    ON d.report_id=r.id AND d.event_kind='initial_decision'
    AND d.result_code='hide'
   WHERE r.comment_id=p_comment_id
    AND NOT EXISTS(
      SELECT 1 FROM allin_private.v2_community_moderation_events a
      WHERE a.report_id=r.id AND a.event_kind='appeal_decision'
       AND a.result_code='overturn'))
  THEN 'hidden'
  WHEN EXISTS(
   SELECT 1 FROM allin_private.v2_community_moderation_reports r
   JOIN allin_private.v2_community_moderation_events d
    ON d.report_id=r.id AND d.event_kind='initial_decision'
    AND d.result_code='hold'
   WHERE r.comment_id=p_comment_id
    AND NOT EXISTS(
      SELECT 1 FROM allin_private.v2_community_moderation_events a
      WHERE a.report_id=r.id AND a.event_kind='appeal_decision'
       AND a.result_code='overturn'))
  THEN 'held' ELSE 'visible' END INTO v_state;
 UPDATE allin_private.v2_community_comments c SET
  moderation_state=v_state,moderation_updated_at=now()
 WHERE c.id=p_comment_id AND c.deleted_at IS NULL;
 RETURN v_state;
END;
$refresh$;
REVOKE ALL ON FUNCTION allin_private.v2_community_refresh_moderation_state(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Both actions serialize a single case using row locks and CAS versions.
-- Different reviewer permissions are required at each decision level.
CREATE OR REPLACE FUNCTION allin_private.v2_community_decide_report(
 p_report_id uuid,p_expected_version bigint,p_decision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $decide$
DECLARE v_actor uuid;v_row allin_private.v2_community_moderation_reports%ROWTYPE;
 v_comment allin_private.v2_community_comments%ROWTYPE;
BEGIN
 v_actor:=allin_private.v2_community_moderation_reviewer('initial_review');
 IF p_report_id IS NULL OR p_expected_version IS NULL OR
  p_decision IS NULL OR p_decision NOT IN ('dismiss','hold','hide')
 THEN RAISE EXCEPTION 'invalid_community_moderation_decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_row FROM allin_private.v2_community_moderation_reports
  WHERE id=p_report_id FOR UPDATE;
 IF v_row.id IS NULL OR v_row.status<>'reported' OR v_row.version<>p_expected_version
 THEN RAISE EXCEPTION 'community_moderation_case_stale' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_comment FROM allin_private.v2_community_comments
  WHERE id=v_row.comment_id FOR UPDATE;
 IF v_comment.id IS NULL OR v_comment.deleted_at IS NOT NULL OR
  v_comment.author_id=v_actor OR v_row.reporter_id=v_actor
 THEN RAISE EXCEPTION 'community_moderation_conflict' USING ERRCODE='42501'; END IF;
 UPDATE allin_private.v2_community_moderation_reports SET
  status='decided',version=version+1,initial_reviewer_id=v_actor,
  reviewed_at=now() WHERE id=p_report_id;
 INSERT INTO allin_private.v2_community_moderation_events
  (report_id,version,actor_id,event_kind,result_code)
 VALUES(p_report_id,p_expected_version+1,v_actor,'initial_decision',p_decision);
 PERFORM allin_private.v2_community_refresh_moderation_state(v_comment.id);
 RETURN pg_catalog.jsonb_build_object('reportId',p_report_id,
  'version',p_expected_version+1,'decision',p_decision);
END;
$decide$;
REVOKE ALL ON FUNCTION allin_private.v2_community_decide_report(uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- Only the affected author may appeal the decision, once per case. Reporter,
-- post owner and reviewer are NOT interchangeable with the comment author.
CREATE OR REPLACE FUNCTION allin_private.v2_community_appeal_report(
 p_report_id uuid,p_expected_version bigint,p_statement text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $appeal$
DECLARE v_actor uuid;v_row allin_private.v2_community_moderation_reports%ROWTYPE;
 v_author uuid;
BEGIN
 v_actor:=allin_private.v2_community_moderation_actor();
 IF p_report_id IS NULL OR p_expected_version IS NULL OR
  p_statement IS NULL OR length(btrim(p_statement)) NOT BETWEEN 1 AND 1000
 THEN RAISE EXCEPTION 'invalid_community_moderation_appeal' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_row FROM allin_private.v2_community_moderation_reports
  WHERE id=p_report_id FOR UPDATE;
 IF v_row.id IS NULL OR v_row.status<>'decided' OR v_row.version<>p_expected_version
 THEN RAISE EXCEPTION 'community_moderation_appeal_stale' USING ERRCODE='40001'; END IF;
 SELECT author_id INTO v_author FROM allin_private.v2_community_comments
  WHERE id=v_row.comment_id;
 IF v_author IS DISTINCT FROM v_actor OR v_row.initial_reviewer_id=v_actor
 THEN RAISE EXCEPTION 'community_moderation_appeal_not_author' USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_community_moderation_appeals
  (report_id,author_id,statement) VALUES(p_report_id,v_actor,btrim(p_statement));
 UPDATE allin_private.v2_community_moderation_reports
  SET status='appealed',version=version+1 WHERE id=p_report_id;
 INSERT INTO allin_private.v2_community_moderation_events
  (report_id,version,actor_id,event_kind,result_code)
 VALUES(p_report_id,p_expected_version+1,v_actor,'appealed','requested');
 RETURN pg_catalog.jsonb_build_object('reportId',p_report_id,
  'version',p_expected_version+1,'appealed',true);
END;
$appeal$;
REVOKE ALL ON FUNCTION allin_private.v2_community_appeal_report(uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION allin_private.v2_community_resolve_appeal(
 p_report_id uuid,p_expected_version bigint,p_decision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $resolve$
DECLARE v_actor uuid;v_row allin_private.v2_community_moderation_reports%ROWTYPE;
 v_comment allin_private.v2_community_comments%ROWTYPE;
BEGIN
 v_actor:=allin_private.v2_community_moderation_reviewer('appeal_review');
 IF p_report_id IS NULL OR p_expected_version IS NULL OR
  p_decision IS NULL OR p_decision NOT IN ('uphold','overturn')
 THEN RAISE EXCEPTION 'invalid_community_appeal_decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_row FROM allin_private.v2_community_moderation_reports
  WHERE id=p_report_id FOR UPDATE;
 IF v_row.id IS NULL OR v_row.status<>'appealed' OR
  v_row.version<>p_expected_version
 THEN RAISE EXCEPTION 'community_moderation_appeal_stale' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_comment FROM allin_private.v2_community_comments
  WHERE id=v_row.comment_id FOR UPDATE;
 IF v_comment.id IS NULL OR v_comment.deleted_at IS NOT NULL OR
  v_row.initial_reviewer_id=v_actor OR v_row.reporter_id=v_actor OR
  v_comment.author_id=v_actor
 THEN RAISE EXCEPTION 'community_moderation_appeal_reviewer_conflict'
   USING ERRCODE='42501'; END IF;
 UPDATE allin_private.v2_community_moderation_reports
  SET status='closed',version=version+1 WHERE id=p_report_id;
 INSERT INTO allin_private.v2_community_moderation_events
  (report_id,version,actor_id,event_kind,result_code)
 VALUES(p_report_id,p_expected_version+1,v_actor,'appeal_decision',p_decision);
 PERFORM allin_private.v2_community_refresh_moderation_state(v_comment.id);
 RETURN pg_catalog.jsonb_build_object('reportId',p_report_id,
  'version',p_expected_version+1,'appealDecision',p_decision);
END;
$resolve$;
REVOKE ALL ON FUNCTION allin_private.v2_community_resolve_appeal(uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE allin_private.v2_community_moderator_grants IS
 'REVIEW ONLY. Independently provision trusted reviewer capability; no in-app grant writer.';
COMMENT ON TABLE allin_private.v2_community_moderation_events IS
 'REVIEW ONLY. Restricted case event provenance. Legal retention/hold duration unapproved.';
