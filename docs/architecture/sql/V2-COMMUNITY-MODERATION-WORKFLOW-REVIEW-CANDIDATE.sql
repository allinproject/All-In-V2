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
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
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


-- ALL-244 TRUSTED OPERATOR/QUEUE EXTENSION, REVIEW ONLY.
-- Operator authority originates ONLY from independent privileged provisioning
-- (reviewed admin SQL and out-of-band approval); no user/API method can
-- bootstrap operator membership or turn an operator into a reviewer.
CREATE TABLE allin_private.v2_community_moderation_operators (
 operator_id uuid PRIMARY KEY REFERENCES public.v2_profiles(user_id)
   ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE allin_private.v2_community_moderation_grant_events (
 action_id uuid PRIMARY KEY,
 operator_id uuid NOT NULL REFERENCES public.v2_profiles(user_id)
   ON DELETE CASCADE,
 reviewer_id uuid NOT NULL REFERENCES public.v2_profiles(user_id)
   ON DELETE CASCADE,
 permission text NOT NULL CHECK(permission IN ('initial_review','appeal_review')),
 enabled boolean NOT NULL,
 grant_version bigint NOT NULL CHECK(grant_version>0),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
-- Evidence reads must have independent provenance; never log private comment
-- body or the reporter's freeform details inside this access receipt.
CREATE TABLE allin_private.v2_community_moderation_evidence_access (
 access_id uuid PRIMARY KEY,
 report_id uuid NOT NULL REFERENCES allin_private.v2_community_moderation_reports(id)
   ON DELETE CASCADE,
 reviewer_id uuid NOT NULL REFERENCES public.v2_profiles(user_id)
   ON DELETE CASCADE,
 read_at timestamptz NOT NULL DEFAULT now()
);
DO $moderation_new_private_acl$
DECLARE v_name text;
BEGIN
 FOREACH v_name IN ARRAY ARRAY[
   'v2_community_moderation_operators',
   'v2_community_moderation_grant_events',
   'v2_community_moderation_evidence_access'
 ] LOOP
  EXECUTE pg_catalog.format(
   'ALTER TABLE allin_private.%I ENABLE ROW LEVEL SECURITY',v_name);
  EXECUTE pg_catalog.format(
   'REVOKE ALL ON allin_private.%I FROM PUBLIC,anon,authenticated,service_role',v_name);
 END LOOP;
END $moderation_new_private_acl$;

-- The operator grant cannot be created by this RPC. Independently authorized
-- administrators must provision and revoke operator membership out of band.
-- Version 0 requests first creation, later CAS requests exact existing version.
-- Stable action_id makes repeated exact requests idempotent, changed retries fail.
CREATE OR REPLACE FUNCTION allin_private.v2_community_operator_set_reviewer(
 p_action_id uuid,p_reviewer_id uuid,p_permission text,
 p_enabled boolean,p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $operator_set$
DECLARE
 v_operator uuid;v_existing allin_private.v2_community_moderator_grants%ROWTYPE;
 v_prior allin_private.v2_community_moderation_grant_events%ROWTYPE;
 v_next bigint;
BEGIN
 v_operator:=allin_private.v2_community_moderation_actor();
 IF NOT EXISTS(SELECT 1 FROM allin_private.v2_community_moderation_operators o
  WHERE o.operator_id=v_operator AND o.enabled)
 THEN RAISE EXCEPTION 'community_operator_not_authorized' USING ERRCODE='42501'; END IF;
 IF p_action_id IS NULL OR p_reviewer_id IS NULL OR
   p_permission IS NULL OR p_permission NOT IN ('initial_review','appeal_review')
   OR p_enabled IS NULL OR p_expected_version IS NULL OR p_expected_version<0
   OR p_reviewer_id=v_operator OR NOT EXISTS(
    SELECT 1 FROM auth.users u JOIN public.v2_profiles pr
     ON pr.user_id=u.id WHERE u.id=p_reviewer_id)
 THEN RAISE EXCEPTION 'community_operator_invalid_reviewer_change' USING ERRCODE='22023'; END IF;
 -- Atomic contention control for the same operator action; prevents a replay
 -- from racing a distinct updated grant. The operator cannot grant self.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('community_mod_grant:'||p_reviewer_id::text||':'||p_permission,0));
 SELECT * INTO v_prior FROM allin_private.v2_community_moderation_grant_events
 WHERE action_id=p_action_id;
 IF v_prior.action_id IS NOT NULL THEN
  IF v_prior.operator_id IS DISTINCT FROM v_operator OR
    v_prior.reviewer_id IS DISTINCT FROM p_reviewer_id OR
    v_prior.permission IS DISTINCT FROM p_permission OR
    v_prior.enabled IS DISTINCT FROM p_enabled
  THEN RAISE EXCEPTION 'community_operator_action_reuse' USING ERRCODE='23505'; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'reviewerId',p_reviewer_id,'permission',p_permission,
    'enabled',v_prior.enabled,'version',v_prior.grant_version,'retry',true);
 END IF;
 SELECT * INTO v_existing
 FROM allin_private.v2_community_moderator_grants
 WHERE reviewer_id=p_reviewer_id AND permission=p_permission FOR UPDATE;
 IF v_existing.reviewer_id IS NULL THEN
  IF p_expected_version<>0 THEN
   RAISE EXCEPTION 'community_operator_grant_stale' USING ERRCODE='40001'; END IF;
  INSERT INTO allin_private.v2_community_moderator_grants
    (reviewer_id,permission,enabled,version)
  VALUES (p_reviewer_id,p_permission,p_enabled,1);
  v_next:=1;
 ELSE
  IF v_existing.version<>p_expected_version THEN
   RAISE EXCEPTION 'community_operator_grant_stale' USING ERRCODE='40001'; END IF;
  UPDATE allin_private.v2_community_moderator_grants
  SET enabled=p_enabled,version=version+1,assigned_at=now()
  WHERE reviewer_id=p_reviewer_id AND permission=p_permission
  RETURNING version INTO v_next;
 END IF;
 INSERT INTO allin_private.v2_community_moderation_grant_events
  (action_id,operator_id,reviewer_id,permission,enabled,grant_version)
 VALUES (p_action_id,v_operator,p_reviewer_id,p_permission,p_enabled,v_next);
 RETURN pg_catalog.jsonb_build_object(
  'reviewerId',p_reviewer_id,'permission',p_permission,
  'enabled',p_enabled,'version',v_next,'retry',false);
END;
$operator_set$;
REVOKE ALL ON FUNCTION allin_private.v2_community_operator_set_reviewer(
 uuid,uuid,text,boolean,bigint)
 FROM PUBLIC,anon,authenticated,service_role;

-- Reviewer sees only the relevant case metadata. Free-form reporter details,
-- private comment text, appeals and identities are NOT included in the queue.
-- A separate case-detail read below is access-audited. A stable (time,id)
-- keyset enables 50-at-a-time pages without silently truncating a backlog.
CREATE OR REPLACE FUNCTION allin_private.v2_community_moderation_queue(
 p_permission text,p_after_time timestamptz DEFAULT NULL,
 p_after_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $queue$
DECLARE v_actor uuid;v_result jsonb;v_rows integer;
 v_next_time timestamptz;v_next_id uuid;
BEGIN
 IF p_permission IS NULL OR p_permission NOT IN ('initial_review','appeal_review')
  OR ((p_after_time IS NULL)<>(p_after_id IS NULL))
 THEN RAISE EXCEPTION 'invalid_community_moderation_cursor' USING ERRCODE='22023'; END IF;
 v_actor:=allin_private.v2_community_moderation_reviewer(p_permission);
 WITH available AS (
  SELECT r.id,r.status,r.version,r.reason_code,
   CASE WHEN p_permission='appeal_review' THEN a.submitted_at
     ELSE r.submitted_at END AS queue_time
  FROM allin_private.v2_community_moderation_reports r
  JOIN allin_private.v2_community_comments c ON c.id=r.comment_id
  LEFT JOIN allin_private.v2_community_moderation_appeals a ON a.report_id=r.id
  WHERE r.status=CASE WHEN p_permission='initial_review'
   THEN 'reported' ELSE 'appealed' END
  AND c.deleted_at IS NULL AND c.author_id<>v_actor
  AND r.reporter_id<>v_actor
  AND (p_permission='initial_review' OR
   (a.report_id IS NOT NULL AND r.initial_reviewer_id<>v_actor))
  AND (p_after_time IS NULL OR
   (CASE WHEN p_permission='appeal_review' THEN a.submitted_at
    ELSE r.submitted_at END,r.id)>(p_after_time,p_after_id))
  ORDER BY queue_time,r.id LIMIT 51
 ), numbered AS (
  SELECT *,row_number() OVER (ORDER BY queue_time,id) AS position FROM available
 ), page AS (SELECT * FROM numbered WHERE position<=50)
 SELECT
  COALESCE((SELECT pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object('reportId',p.id,'status',p.status,
    'version',p.version,'reasonCode',p.reason_code,
    'submittedAt',p.queue_time) ORDER BY p.queue_time,p.id) FROM page p),
    '[]'::jsonb),
  (SELECT count(*) FROM numbered),
  (SELECT queue_time FROM page ORDER BY position DESC LIMIT 1),
  (SELECT id FROM page ORDER BY position DESC LIMIT 1)
 INTO v_result,v_rows,v_next_time,v_next_id;
 RETURN pg_catalog.jsonb_build_object(
  'permission',p_permission,'cases',v_result,'complete',v_rows<=50,
  'nextCursor',CASE WHEN v_rows>50
   THEN pg_catalog.jsonb_build_object('submittedAt',v_next_time,'reportId',v_next_id)
   ELSE NULL END);
END;
$queue$;
REVOKE ALL ON FUNCTION allin_private.v2_community_moderation_queue(
 text,timestamptz,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Separate, audited evidence access; never log the private body in audit.
-- A reviewer with live capability can inspect one active case only, and
-- cannot review a case they reported, authored, or initially decided on appeal.
CREATE OR REPLACE FUNCTION allin_private.v2_community_moderation_case_detail(
 p_access_id uuid,p_report_id uuid,p_permission text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $case_detail$
DECLARE v_actor uuid;v_case allin_private.v2_community_moderation_reports%ROWTYPE;
 v_comment allin_private.v2_community_comments%ROWTYPE;
 v_access allin_private.v2_community_moderation_evidence_access%ROWTYPE;
 v_appeal text;
BEGIN
 IF p_access_id IS NULL OR p_report_id IS NULL OR
  p_permission IS NULL OR p_permission NOT IN ('initial_review','appeal_review')
 THEN RAISE EXCEPTION 'invalid_community_case_request' USING ERRCODE='22023'; END IF;
 v_actor:=allin_private.v2_community_moderation_reviewer(p_permission);
 SELECT * INTO v_case FROM allin_private.v2_community_moderation_reports
 WHERE id=p_report_id;
 IF v_case.id IS NULL OR
   v_case.status<>CASE WHEN p_permission='initial_review' THEN 'reported' ELSE 'appealed' END
   OR v_case.reporter_id=v_actor OR
   (p_permission='appeal_review' AND v_case.initial_reviewer_id=v_actor)
 THEN RAISE EXCEPTION 'community_case_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_comment FROM allin_private.v2_community_comments
 WHERE id=v_case.comment_id AND deleted_at IS NULL;
 IF v_comment.id IS NULL OR v_comment.author_id=v_actor
 THEN RAISE EXCEPTION 'community_case_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_access FROM allin_private.v2_community_moderation_evidence_access
 WHERE access_id=p_access_id;
 IF v_access.access_id IS NOT NULL THEN
  IF v_access.reviewer_id IS DISTINCT FROM v_actor OR
   v_access.report_id IS DISTINCT FROM p_report_id
  THEN RAISE EXCEPTION 'community_evidence_access_id_conflict' USING ERRCODE='23505'; END IF;
 ELSE
  INSERT INTO allin_private.v2_community_moderation_evidence_access(
   access_id,report_id,reviewer_id)
  VALUES(p_access_id,p_report_id,v_actor);
 END IF;
 SELECT a.statement INTO v_appeal
 FROM allin_private.v2_community_moderation_appeals a
 WHERE a.report_id=p_report_id AND p_permission='appeal_review';
 RETURN pg_catalog.jsonb_build_object(
  'reportId',p_report_id,'status',v_case.status,'version',v_case.version,
  'reasonCode',v_case.reason_code,'reasonDetail',v_case.reason_detail,
  'commentId',v_comment.id,'body',v_comment.body,
  'appealStatement',CASE WHEN p_permission='appeal_review'
   THEN v_appeal ELSE NULL END);
END;
$case_detail$;
REVOKE ALL ON FUNCTION allin_private.v2_community_moderation_case_detail(
 uuid,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
