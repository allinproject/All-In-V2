-- ALL-222/243/246/251 REVIEW ONLY. DO NOT MERGE/DEPLOY. Unit 5 of 5.
-- Extend EXISTING account export request/session/worker lifecycle with canonical Training/Activity fragments.

-- Source 25: V2-ACCOUNT-EXPORT-SESSION-AUTH-REVIEW-CANDIDATE.sql [Git blob 0987decd765a76a825522fd1b25880e7073c347d]
-- ALL-251 REVIEW ONLY — session-bound authorization for EXISTING V2
-- account-export workflow. NOT A MIGRATION OR DEPLOYABLE RELEASE.
--
-- An authenticated owner invokes the existing public account-export entrypoint;
-- the eventual trusted worker separately requires this gate to validate the
-- same Auth user, current session and deletion state before ANY Storage read.
-- Never expose this function to anon/authenticated or arbitrary client RPC.
-- The server must obtain p_session_id from a validated bearer token, never
-- client JSON. This is a private, service-role-only authorization probe.
CREATE FUNCTION allin_private.v2_account_export_authorize_session_candidate(
  p_user_id uuid, p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $auth$
DECLARE
  v_deletion text;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL THEN
   RAISE EXCEPTION 'Export requires exact account and session' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM auth.users u WHERE u.id=p_user_id
 ) THEN
   RAISE EXCEPTION 'Export account no longer exists' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM auth.sessions s
   WHERE s.id=p_session_id AND s.user_id=p_user_id
 ) THEN
   RAISE EXCEPTION 'Export session missing or revoked' USING ERRCODE='42501';
 END IF;
 SELECT status INTO v_deletion
 FROM allin_private.v2_account_deletion_requests
 WHERE user_id=p_user_id;
 -- A pending deletion request should not permit a new private archive until
 -- explicitly cancelled. The export and deletion features must reconcile
 -- their legal requirements in ALL-251 before enabling this gate.
 IF v_deletion IS NOT NULL AND v_deletion<>'cancelled' THEN
   RAISE EXCEPTION 'Deletion state blocks private export' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object(
   'ownerId',p_user_id,'sessionId',p_session_id,
   'activeSession',true,'exportPermitted',true,
   'completeUserExport',false
 );
END;
$auth$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit service_role grant MUST be reviewed in the owning ALL-251
-- migration with full provider identity and server-call acceptance.


-- Source 26: V2-ACCOUNT-EXPORT-REQUEST-OWNER-REVIEW-CANDIDATE.sql [Git blob db9c3a7056318531bb155702572a88a09c46e430]
-- ALL-251 REVIEW ONLY — durable requests owned by EXISTING account export.
-- NOT A MIGRATION. No client writer, no worker scheduling, no grants.
-- The existing account-export Profile flow remains the sole initiation UX.
-- This model stores an explicit server-reviewed export job identity so a valid
-- login alone cannot open arbitrary historical private workout files.
CREATE TABLE allin_private.v2_account_export_requests_candidate (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'requested'
   CHECK(status IN ('requested','approved','staging','staged','expired','cancelled','failed')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>requested_at AND expires_at<=requested_at+interval '24 hours')
);
CREATE INDEX v2_export_req_owner_status ON allin_private.v2_account_export_requests_candidate(user_id,status);
ALTER TABLE allin_private.v2_account_export_requests_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_export_requests_candidate FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_account_export_authorize_request_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $auth$
DECLARE
 v_session jsonb;
 v_request allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 v_session:=allin_private.v2_account_export_authorize_session_candidate(p_user_id,p_session_id);
 IF v_session->>'activeSession'<>'true'
 THEN RAISE EXCEPTION 'Current Auth session is not eligible' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_request FROM allin_private.v2_account_export_requests_candidate
 WHERE request_id=p_request_id AND user_id=p_user_id
   AND session_id=p_session_id;
 IF NOT FOUND OR v_request.status NOT IN ('approved','staging','staged')
   OR v_request.expires_at<=pg_catalog.now()
 THEN RAISE EXCEPTION 'Export request is not approved or has expired' USING ERRCODE='42501'; END IF;
 RETURN pg_catalog.jsonb_build_object('requestId',p_request_id,
  'ownerId',p_user_id,'sessionId',p_session_id,
  'status','approved','cancelled',false,'expiresAt',v_request.expires_at);
END;
$auth$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_authorize_request_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- No client request creation or service grant until canonical ALL-251
-- export worker, migration/rollback and personal-data coverage are approved.


-- Source 27: V2-ACCOUNT-EXPORT-WORKER-RPC-REVIEW-CANDIDATE.sql [Git blob 95528bbc2668718ac9d3128fcb010af1a29a574f]
-- ALL-251 REVIEW ONLY: service-only Data API bridge to the private,
-- session- and request-bound existing account-export authorization.
-- NOT A MIGRATION; remains uncallable by all API roles until owner signoff.
-- The private schema must NEVER be exposed to PostgREST merely for this.
CREATE FUNCTION public.v2_account_export_worker_authorize_candidate(
  p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $worker$
BEGIN
  -- Service-role caller permission is granted explicitly only after release.
  -- Auth user/session, deletion status, exact approved request and TTL are
  -- all checked by the owning allin_private implementations.
  RETURN allin_private.v2_account_export_authorize_request_candidate(
    p_user_id,p_session_id,p_request_id
  );
END;
$worker$;
REVOKE ALL ON FUNCTION
 public.v2_account_export_worker_authorize_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Owner-approved release ONLY:
-- GRANT EXECUTE ON FUNCTION
-- public.v2_account_export_worker_authorize_candidate(uuid,uuid,uuid)
-- TO service_role;
-- Never grant to anon/authenticated. Do not enable by default.


-- Source 28: V2-ACCOUNT-EXPORT-REQUEST-LIFECYCLE-REVIEW-CANDIDATE.sql [Git blob cb672cfdc5ebdc4408bbe7088e60b0e4968563da]
-- ALL-251 REVIEW ONLY — owner-initiated request lifecycle for the EXISTING
-- Profile account-export feature. NOT A MIGRATION. All RPC grants OFF.
-- Do not enable until legal/export/Storage and user-device acceptance.
CREATE FUNCTION public.v2_begin_account_export_candidate(
 p_expected_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $begin$
DECLARE
 v_owner uuid:=auth.uid();
 v_session_claim text:=auth.jwt()->>'session_id';
 v_session uuid;
 v_existing allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 IF v_owner IS NULL OR p_expected_user_id IS DISTINCT FROM v_owner
    OR v_session_claim IS NULL
    OR v_session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Active export owner and session required' USING ERRCODE='42501'; END IF;
 v_session:=v_session_claim::uuid;
 -- Serialize with the EXISTING ALL-251 deletion request owner lock.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||v_owner::text,0));
 PERFORM allin_private.v2_account_export_authorize_session_candidate(v_owner,v_session);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-export-request:'||v_owner::text,0));
 SELECT * INTO v_existing
 FROM allin_private.v2_account_export_requests_candidate
 WHERE user_id=v_owner AND status IN ('requested','approved','staging','staged')
   AND expires_at>pg_catalog.now()
 ORDER BY requested_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO allin_private.v2_account_export_requests_candidate(
   request_id,user_id,session_id,status,expires_at)
  VALUES(pg_catalog.gen_random_uuid(),v_owner,v_session,'requested',
   pg_catalog.now()+interval '1 hour')
  RETURNING * INTO v_existing;
 ELSIF v_existing.session_id<>v_session THEN
  RAISE EXCEPTION 'Existing export request belongs to another session'
   USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',v_owner,
   'requestId',v_existing.request_id,'status',v_existing.status,
   'expiresAt',v_existing.expires_at,'completeUserExport',false);
END;
$begin$;
REVOKE ALL ON FUNCTION public.v2_begin_account_export_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_account_export_approve_request_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $approve$
DECLARE
 v_request allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 -- Lock in the same order as owner initiation to prevent concurrent
 -- account-deletion requests from racing into an export approval.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_user_id::text,0));
 PERFORM allin_private.v2_account_export_authorize_session_candidate(
  p_user_id,p_session_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-export-request:'||p_user_id::text,0));
 SELECT * INTO v_request
 FROM allin_private.v2_account_export_requests_candidate
 WHERE user_id=p_user_id AND session_id=p_session_id
   AND request_id=p_request_id
 FOR UPDATE;
 IF NOT FOUND OR v_request.status NOT IN ('requested','approved')
    OR v_request.expires_at<=pg_catalog.now()
 THEN RAISE EXCEPTION 'Export request cannot be approved' USING ERRCODE='42501'; END IF;
 IF v_request.status='requested' THEN
  UPDATE allin_private.v2_account_export_requests_candidate
  SET status='approved',updated_at=pg_catalog.now()
  WHERE request_id=p_request_id AND status='requested'
  RETURNING * INTO v_request;
 END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',v_request.user_id,
  'sessionId',v_request.session_id,'requestId',v_request.request_id,
  'status',v_request.status,'expiresAt',v_request.expires_at);
END;
$approve$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_approve_request_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Service-only PostgREST bridge. No private schema exposure or client grants.
CREATE FUNCTION public.v2_account_export_worker_approve_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $worker$
BEGIN
 RETURN allin_private.v2_account_export_approve_request_candidate(
   p_user_id,p_session_id,p_request_id);
END;
$worker$;
REVOKE ALL ON FUNCTION
 public.v2_account_export_worker_approve_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit owner-reviewed authenticated begin and service-role approve grants
-- must be separate approved migration steps. Everything stays OFF now.


-- Source 29: V2-TRAINING-ACCOUNT-EXPORT-FRAGMENT-CANDIDATE.sql [Git blob 273ff259d9f4daa3e504fceb5ca680364d303137]
-- ALL-251 / ALL-243 REVIEW ONLY owner-scoped account export fragment.
-- NOT A MIGRATION, NOT AN APPROVED USER DOWNLOAD. This is a private
-- candidate extension of EXISTING ALL-251 owner export, not a competing API.
-- Requires the full candidate Training/Completed Activity owner graph.
-- Does NOT export private Storage objects/bytes; export remains incomplete.
CREATE FUNCTION allin_private.v2_training_account_export_fragment_candidate(
 p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fragment$
DECLARE
 v_edge record;
 v_rows jsonb;
 v_record_map jsonb:='{}'::jsonb;
 v_total bigint:=0;
 v_missing text[];
 v_unexpected text[];
BEGIN
 IF p_user_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM auth.users WHERE id=p_user_id
 ) THEN RAISE EXCEPTION 'Active export owner required' USING ERRCODE='42501'; END IF;
 -- Explicit scope must be maintained whenever another owner table appears.
 -- Each table below stores user_id; shared challenge definitions and public
 -- metric definitions are intentionally not exported as personal records.
 FOR v_edge IN SELECT * FROM (VALUES
 ('public','v2_training_session_instances'),
 ('public','v2_completed_activities'),
 ('public','v2_activity_sources'),
 ('public','v2_training_plans'),
 ('public','v2_training_plan_revisions'),
 ('public','v2_training_session_slots'),
 ('public','v2_training_revision_days'),
 ('public','v2_training_revision_sessions'),
 ('public','v2_training_execution_events'),
 ('allin_private','v2_training_action_receipts'),
 ('allin_private','v2_training_completion_outbox'),
 ('allin_private','v2_training_plan_accept_receipts'),
 ('allin_private','v2_account_export_requests_candidate'),
 ('public','v2_activity_metric_values'),
 ('public','v2_activity_segments'),
 ('public','v2_activity_strength_sets'),
 ('public','v2_activity_series'),
 ('public','v2_activity_route_objects'),
 ('public','v2_indoor_weekly_attempts'),
 ('public','v2_indoor_weekly_leaderboard'),
 ('public','v2_indoor_weekly_achievements')
 ) AS scope(schema_name,table_name)
 LOOP
  IF NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped
   WHERE n.nspname=v_edge.schema_name AND c.relname=v_edge.table_name
     AND c.relkind IN ('r','p')
  ) THEN RAISE EXCEPTION 'Missing required owner export relation %.%',
     v_edge.schema_name,v_edge.table_name USING ERRCODE='42501'; END IF;
  EXECUTE pg_catalog.format(
    'SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY pg_catalog.to_jsonb(r)::text),''[]''::jsonb) FROM %I.%I r WHERE user_id=$1',
    v_edge.schema_name,v_edge.table_name
  ) INTO v_rows USING p_user_id;
  v_total:=v_total+pg_catalog.jsonb_array_length(v_rows);
  v_record_map:=pg_catalog.jsonb_set(v_record_map,
    ARRAY[v_edge.schema_name||'.'||v_edge.table_name],v_rows);
 END LOOP;
 -- Compare exact qualified owner-table identity, not count alone.
 -- An unexpected new owner table cannot replace an expected table unnoticed.
 WITH expected(qualified_name) AS (VALUES
 ('public.v2_training_session_instances'),
 ('public.v2_completed_activities'),
 ('public.v2_activity_sources'),
 ('public.v2_training_plans'),
 ('public.v2_training_plan_revisions'),
 ('public.v2_training_session_slots'),
 ('public.v2_training_revision_days'),
 ('public.v2_training_revision_sessions'),
 ('public.v2_training_execution_events'),
 ('allin_private.v2_training_action_receipts'),
 ('allin_private.v2_training_completion_outbox'),
 ('allin_private.v2_training_plan_accept_receipts'),
 ('allin_private.v2_account_export_requests_candidate'),
 ('public.v2_activity_metric_values'),
 ('public.v2_activity_segments'),
 ('public.v2_activity_strength_sets'),
 ('public.v2_activity_series'),
 ('public.v2_activity_route_objects'),
 ('public.v2_indoor_weekly_attempts'),
 ('public.v2_indoor_weekly_leaderboard'),
 ('public.v2_indoor_weekly_achievements')
 ), actual AS (
 SELECT n.nspname||'.'||c.relname AS qualified_name
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')
   AND (c.relname LIKE 'v2_training%' OR c.relname LIKE 'v2_completed%'
     OR c.relname LIKE 'v2_activity_%' OR c.relname LIKE 'v2_indoor_weekly%'
     OR c.relname = 'v2_account_export_requests_candidate')
 )
 SELECT
   ARRAY(SELECT qualified_name FROM expected EXCEPT SELECT qualified_name FROM actual),
   ARRAY(SELECT qualified_name FROM actual EXCEPT SELECT qualified_name FROM expected)
 INTO v_missing,v_unexpected;
 IF pg_catalog.cardinality(v_missing)<>0 OR pg_catalog.cardinality(v_unexpected)<>0 THEN
   RAISE EXCEPTION 'Training export owner-coverage mismatch: missing %, unexpected %',
      v_missing,v_unexpected USING ERRCODE='42501';
 END IF;
 -- The existing ALL-251 account export is the only public entrypoint.
 -- This fragment is not a complete right-to-export implementation.
 RETURN pg_catalog.jsonb_build_object(
   'schema_version','v2-training-account-fragment-candidate-v1',
   'ownerId',p_user_id,'recordCount',v_total,
   'records',v_record_map,'privateObjectBytesIncluded',false,
   'completeUserExport',false
 );
END;
$fragment$;
REVOKE ALL ON FUNCTION allin_private.v2_training_account_export_fragment_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;


-- Source 30: V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql [Git blob 0c296e6716eb63292758258b52d6110b2b4f8b4e]
-- ALL-251 / ALL-243 / ALL-222 REVIEW ONLY: existing account-export RPC with
-- the Training/Activity and Coach owner data integrated. NOT A MIGRATION.
-- Requires owner-approved new Training tables, private fragment and
-- replacement mobile snapshot schema handling BEFORE any release.
-- Generated from current canonical ALL-251 function, not a new API.
-- ALL-251: account-scoped snapshot of CURRENT V2 user-owned data.
-- Deliberately refuse export when new unhandled user tables/Storage appear.
-- This is a backend data snapshot, NOT yet a finished downloadable export.
create or replace function public.v2_export_my_account_snapshot(p_expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();
 v_export jsonb;
 v_goals jsonb;
 v_goal_edition_links jsonb;
 v_eventhub jsonb;
 v_community jsonb;
 v_billing jsonb;
 v_relation record;
begin
 if v_user is null or p_expected_user_id is distinct from v_user
   or not exists(select 1 from auth.users where id=v_user) then
   raise exception 'Active account ownership required for export' using errcode='42501';
 end if;
 if exists(select 1 from storage.buckets) then
   raise exception 'Account export needs Storage coverage before use' using errcode='42501';
 end if;
 if exists (
   select 1 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid
      and a.attname='user_id' and a.attnum>0 and not a.attisdropped
   where n.nspname in ('public','allin_private') and c.relkind in ('r','p')
     and not (
       (n.nspname='public' and c.relname=any(array[
         'v2_profiles','v2_profile_settings','v2_onboarding_progress','v2_legal_acceptances',
         'v2_coach_threads','v2_coach_messages',
         'v2_goals','v2_goal_revisions','v2_goal_revision_behavior_targets',
         'v2_goal_event_edition_links',
         'v2_event_group_memberships','v2_event_participations'
       ]))
       or (n.nspname='allin_private' and c.relname=any(array[
         'v2_health_considerations','v2_profile_settings_actions','v2_onboarding_actions',
         'v2_account_deletion_requests','v2_account_deletion_execution_audit',
         'v2_community_visibility','v2_goal_acceptance_actions',
         'v2_goal_approval_reviews','v2_event_group_actions'
       ]))
       or (n.nspname='public' and c.relname=any(array[
         'v2_training_session_instances','v2_completed_activities','v2_activity_sources',
         'v2_training_plans','v2_training_plan_revisions','v2_training_session_slots',
         'v2_training_revision_days','v2_training_revision_sessions',
         'v2_training_execution_events','v2_activity_metric_values',
         'v2_activity_segments','v2_activity_strength_sets','v2_activity_series',
         'v2_activity_route_objects','v2_indoor_weekly_attempts',
         'v2_indoor_weekly_leaderboard','v2_indoor_weekly_achievements'
       ]))
       or (n.nspname='allin_private' and c.relname=any(array[
         'v2_training_action_receipts','v2_training_completion_outbox',
         'v2_coach_turn_claims',
         'v2_training_plan_accept_receipts','v2_account_export_requests_candidate'
       ]))
     )
 ) then
   raise exception 'New personal data tables require export coverage' using errcode='42501';
 end if;

 -- Future Nutrition, Progress, cookbook and equipment schemas are not
 -- covered merely because an author chose a different owner column name.
 -- Block new domain tables (including reference-like names) until each is
 -- classified as personal or reference and added to this owning registry.
 IF EXISTS (
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')
     AND (c.relname LIKE 'v2_nutrition_%'
       OR c.relname LIKE 'v2_progress_%'
       OR c.relname LIKE 'v2_food_%'
       OR c.relname LIKE 'v2_recipe_%'
       OR c.relname LIKE 'v2_cookbook_%'
       OR c.relname LIKE 'v2_gear_%'
       OR c.relname LIKE 'v2_shoe_%'
       OR c.relname LIKE 'v2_meal_%'
       OR c.relname LIKE 'v2_pantry_%'
       OR c.relname LIKE 'v2_macro_%'
       OR c.relname LIKE 'v2_body_%'
       OR c.relname LIKE 'v2_equipment_%'
       OR c.relname LIKE 'v2_race_%'
       OR c.relname LIKE 'v2_personal_record_%'
       OR c.relname LIKE 'v2_achievement_%')
 ) THEN RAISE EXCEPTION 'New domain requires explicit account export classification'
   USING ERRCODE='42501'; END IF;
 -- Future owner data can use owner_id / athlete_id / actor_id rather
 -- than user_id.  Reject unknown V2 relations before a supposedly complete
 -- export silently skips Nutrition, Progress, equipment or Community posts.
 -- The four canonical directional relationship ledgers are reviewed below.
 IF EXISTS(
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname IN ('public','allin_private')
     AND c.relkind IN ('r','p') AND c.relname LIKE 'v2_%'
     AND a.attnum>0 AND NOT a.attisdropped
     AND a.attname IN ('owner_id','athlete_id','actor_id','created_by_user_id',
       'account_id','profile_id','athlete_user_id')
     AND NOT EXISTS(
       SELECT 1 FROM pg_catalog.pg_attribute owned
       WHERE owned.attrelid=c.oid AND owned.attname='user_id'
         AND owned.attnum>0 AND NOT owned.attisdropped
     )
     AND NOT (
       n.nspname='allin_private' AND c.relname=ANY(ARRAY[
         'v2_community_pair_revisions','v2_community_follows',
         'v2_community_blocks','v2_community_action_receipts',
         'v2_subscription_checkout_attempts','v2_subscription_purchases'
       ])
     )
 ) THEN RAISE EXCEPTION 'Unreviewed alternate-key owner table requires export coverage'
      USING ERRCODE='42501'; END IF;

 -- Only include this domain when its FULL reviewed candidate graph exists.
 -- Missing half a domain is not an empty export: reject it.
 if exists(select 1 from (values
   ('public.v2_goals'),
   ('public.v2_goal_revisions'),
   ('public.v2_goal_revision_behavior_targets'),
   ('allin_private.v2_goal_acceptance_actions'),
   ('allin_private.v2_goal_approval_reviews')
 ) as expected(relation_name)
 where pg_catalog.to_regclass(expected.relation_name) is not null) then
   if exists(select 1 from (values
     ('public.v2_goals'),
     ('public.v2_goal_revisions'),
     ('public.v2_goal_revision_behavior_targets'),
     ('allin_private.v2_goal_acceptance_actions'),
     ('allin_private.v2_goal_approval_reviews')
   ) as expected(relation_name)
   where pg_catalog.to_regclass(expected.relation_name) is null) then
     raise exception 'Partial goals export domain schema' using errcode='42501';
   end if;
   -- Preserve typed accepted Goal/Event edition bindings in the owning Goals
   -- export. The link table is a review candidate and may not exist in
   -- older foundation-only schema replays.
   if pg_catalog.to_regclass('public.v2_goal_event_edition_links') is not null then
     select coalesce(jsonb_agg(to_jsonb(l) order by l.goal_revision_id),'[]'::jsonb)
       into v_goal_edition_links
       from public.v2_goal_event_edition_links l where l.user_id=v_user;
   else
     v_goal_edition_links := '[]'::jsonb;
   end if;
   select jsonb_build_object(
     'event_edition_links',v_goal_edition_links,
     'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.id)
       from public.v2_goals g where g.user_id=v_user),'[]'::jsonb),
     'revisions',coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
       from public.v2_goal_revisions r where r.user_id=v_user),'[]'::jsonb),
     'behavior_targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
       from public.v2_goal_revision_behavior_targets t where t.user_id=v_user),'[]'::jsonb),
     'acceptance_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.action_id)
       from allin_private.v2_goal_acceptance_actions a where a.user_id=v_user),'[]'::jsonb),
     'approval_reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
       from allin_private.v2_goal_approval_reviews r where r.user_id=v_user),'[]'::jsonb)
   ) into v_goals;
 end if;
 -- Only include this domain when its FULL reviewed candidate graph exists.
 -- Missing half a domain is not an empty export: reject it.
 if exists(select 1 from (values
   ('public.v2_event_group_memberships'),
   ('public.v2_event_participations'),
   ('allin_private.v2_event_group_actions')
 ) as expected(relation_name)
 where pg_catalog.to_regclass(expected.relation_name) is not null) then
   if exists(select 1 from (values
     ('public.v2_event_group_memberships'),
     ('public.v2_event_participations'),
     ('allin_private.v2_event_group_actions')
   ) as expected(relation_name)
   where pg_catalog.to_regclass(expected.relation_name) is null) then
     raise exception 'Partial eventhub export domain schema' using errcode='42501';
   end if;
   select jsonb_build_object(
     'group_memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.group_id)
       from public.v2_event_group_memberships m where m.user_id=v_user),'[]'::jsonb),
     'participations',coalesce((select jsonb_agg(to_jsonb(p) order by p.event_id)
       from public.v2_event_participations p where p.user_id=v_user),'[]'::jsonb),
     'group_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.action_id)
       from allin_private.v2_event_group_actions a where a.user_id=v_user),'[]'::jsonb)
   ) into v_eventhub;
 end if;
 -- Only include this domain when its FULL reviewed candidate graph exists.
 -- Missing half a domain is not an empty export: reject it.
 -- A new directional Community table may not have a user_id column.
 -- Refuse to export as if complete until its privacy/ownership contract is
 -- reviewed and integrated here (same canonical export entrypoint).
 if exists (
   select 1 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='allin_private' and c.relkind in ('r','p')
     and c.relname like 'v2_community_%'
     and c.relname <> all(array[
       'v2_community_visibility','v2_community_pair_revisions',
       'v2_community_follows','v2_community_blocks',
       'v2_community_action_receipts'
     ])
 ) then
   raise exception 'Unknown directional Community table requires export review'
     using errcode='42501';
 end if;
 -- Directional social relations do not carry a user_id column. They MUST be
 -- reviewed as a complete group, never silently left out of owner export.
 -- Incoming *block* decisions are another actor's private information and
 -- must not be disclosed through an account export.
 if exists(select 1 from (values
   ('allin_private.v2_community_visibility'),
   ('allin_private.v2_community_pair_revisions'),
   ('allin_private.v2_community_follows'),
   ('allin_private.v2_community_blocks'),
   ('allin_private.v2_community_action_receipts')
 ) as expected(relation_name)
 where pg_catalog.to_regclass(expected.relation_name) is not null) then
   if exists(select 1 from (values
     ('allin_private.v2_community_visibility'),
     ('allin_private.v2_community_pair_revisions'),
     ('allin_private.v2_community_follows'),
     ('allin_private.v2_community_blocks'),
     ('allin_private.v2_community_action_receipts')
   ) as expected(relation_name)
   where pg_catalog.to_regclass(expected.relation_name) is null) then
     raise exception 'Partial community relationship export domain schema' using errcode='42501';
   end if;
   select jsonb_build_object(
     'visibility',(select to_jsonb(v) from allin_private.v2_community_visibility v
       where v.user_id=v_user),
     'outgoing_follows',coalesce((select jsonb_agg(to_jsonb(f) order by f.followed_id)
       from allin_private.v2_community_follows f where f.follower_id=v_user),'[]'::jsonb),
     'incoming_follow_requests',coalesce((select jsonb_agg(
       jsonb_build_object('follower_id',f.follower_id,'state',f.state,
         'requested_at',f.requested_at,'approved_at',f.approved_at)
       order by f.follower_id)
       from allin_private.v2_community_follows f where f.followed_id=v_user
       and not exists (select 1 from allin_private.v2_community_blocks b
         where (b.blocker_id=f.follower_id and b.blocked_id=v_user)
           or (b.blocker_id=v_user and b.blocked_id=f.follower_id))),'[]'::jsonb),
     'outgoing_blocks',coalesce((select jsonb_agg(to_jsonb(b) order by b.blocked_id)
       from allin_private.v2_community_blocks b where b.blocker_id=v_user),'[]'::jsonb),
     'my_action_receipts',coalesce((select jsonb_agg(jsonb_build_object('action_id',a.action_id,'action',a.action,'target_id',a.target_id,'created_at',a.created_at) order by a.created_at,a.action_id)
       from allin_private.v2_community_action_receipts a where a.actor_id=v_user),'[]'::jsonb),
     'incoming_blocks_disclosed',false,
     'pair_revisions_disclosed',false,
     'relationship_export_policy','actor_owned_and_recipient_follow_requests_v1',
     'complete_community_export',false
   ) into v_community;
 end if;

 -- Billing is owned through owner_id, not user_id. Event receipts inherit
 -- ownership via purchase_id. Provider internal IDs must not leak into export.
 IF EXISTS(
   SELECT 1 FROM (VALUES
    ('allin_private.v2_subscription_checkout_attempts'),
    ('allin_private.v2_subscription_purchases'),
    ('allin_private.v2_subscription_verified_events')
   ) AS required(name) WHERE pg_catalog.to_regclass(required.name) IS NULL
 ) THEN RAISE EXCEPTION 'Billing export source graph is incomplete'
    USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.jsonb_build_object(
   'checkout_attempts',coalesce((SELECT pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('attemptId',t.attempt_id,'provider',t.provider,
       'environment',t.environment,'offerKind',t.offer_kind,
       'state',t.state,'verifiedAt',t.verified_at) ORDER BY t.attempt_id)
       FROM allin_private.v2_subscription_checkout_attempts t
       WHERE t.owner_id=v_user),'[]'::jsonb),
   'purchases',coalesce((SELECT pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('purchaseId',t.id,'checkoutAttemptId',t.checkout_attempt_id,
       'provider',t.provider,'environment',t.environment,'phase',t.phase,
       'revision',t.revision,'accessUntil',t.access_until,'updatedAt',t.updated_at)
       ORDER BY t.id)
       FROM allin_private.v2_subscription_purchases t
       WHERE t.owner_id=v_user),'[]'::jsonb),
   'verified_events',coalesce((SELECT pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('purchaseId',e.purchase_id,'provider',e.provider,
       'environment',e.environment,'revision',e.revision,'acceptedAt',e.accepted_at)
       ORDER BY e.purchase_id,e.revision)
       FROM allin_private.v2_subscription_verified_events e
       JOIN allin_private.v2_subscription_purchases p ON p.id=e.purchase_id
       WHERE p.owner_id=v_user),'[]'::jsonb),
   'providerInternalIdentifiersDisclosed',false
 ) INTO v_billing;

 select jsonb_build_object(
   'schema_version','v2-account-export-snapshot-v2',
   'exported_at',now(),
   'account', (select jsonb_build_object('id',u.id,'email',u.email,
       'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at)
     from auth.users u where u.id=v_user),
   'profile',(select to_jsonb(p) from public.v2_profiles p where p.user_id=v_user),
   'profile_settings',(select to_jsonb(s) from public.v2_profile_settings s where s.user_id=v_user),
   'onboarding_progress',(select to_jsonb(o) from public.v2_onboarding_progress o where o.user_id=v_user),
   'legal_acceptances',coalesce((select jsonb_agg(to_jsonb(l) order by l.accepted_at)
     from public.v2_legal_acceptances l where l.user_id=v_user),'[]'::jsonb),
   'health_considerations',(select to_jsonb(h) from allin_private.v2_health_considerations h where h.user_id=v_user),
   'profile_settings_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
     from allin_private.v2_profile_settings_actions a where a.user_id=v_user),'[]'::jsonb),
   'onboarding_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
     from allin_private.v2_onboarding_actions a where a.user_id=v_user),'[]'::jsonb),
   'deletion_request',(select to_jsonb(d) from allin_private.v2_account_deletion_requests d where d.user_id=v_user),
   'deletion_execution',(select to_jsonb(d) from allin_private.v2_account_deletion_execution_audit d where d.user_id=v_user),
   'goals',v_goals,
   'eventhub',v_eventhub,
   'community',v_community,
   'billing',v_billing,
   'training_activity',allin_private.v2_training_account_export_fragment_candidate(v_user),
   -- Export the one persistent conversation and its messages.
   -- Private pre-provider claims contain execution/fencing internals, not
   -- portable conversation content; they remain server-only and cascade-delete.
   'coach_conversation',pg_catalog.jsonb_build_object(
     'schema_version','v2-coach-account-fragment-candidate-v2',
     'threads',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.created_at,t.id)
       from public.v2_coach_threads t where t.user_id=v_user),'[]'::jsonb),
     'messages',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.created_at,m.id)
       from public.v2_coach_messages m where m.user_id=v_user),'[]'::jsonb)
   )
 ) into v_export;
 if pg_catalog.octet_length(v_export::text) > 5000000 then
   raise exception 'Account snapshot exceeds inline limit; secure export required' using errcode='54000';
 end if;
 return v_export;
end;$function$;
revoke all on function public.v2_export_my_account_snapshot(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_export_my_account_snapshot(uuid) to authenticated;
comment on function public.v2_export_my_account_snapshot(uuid) is
 'Owner-only V2 current-schema snapshot v2 candidate including Training, Activity and Coach conversation records; not live or file export. Fails closed for missing tables and Storage.';
