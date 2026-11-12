-- ALL-251 REVIEW ONLY. Supplement the existing canonical owner export with
-- a restricted server-side paginated source. NOT a versioned migration.
-- This intentionally does NOT set completeUserExport=true. A single repeatable-
-- read transaction is required across all pages; HTTP requests cannot open
-- independent RPC transactions and pretend their snapshots are equivalent.
--
-- Existing ALL-251 approved-session + exact durable request gate is mandatory.
-- No direct user-table grants; PUBLIC RPC is SERVICE_ROLE ONLY in disposable CI.
BEGIN;
CREATE OR REPLACE FUNCTION public.v2_account_export_inventory_review_candidate(
 p_owner uuid,p_session uuid,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $inventory$
DECLARE
 v_expected text[];
 v_actual text[];
 v_missing text[];
 v_unknown text[];
 v_snapshot uuid;
BEGIN
 PERFORM allin_private.v2_account_export_authorize_request_candidate(
   p_owner,p_session,p_request);
 IF pg_catalog.current_setting('transaction_isolation')<>'repeatable read'
 THEN RAISE EXCEPTION 'Account pages require one repeatable-read transaction'
  USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets)
 THEN RAISE EXCEPTION 'Storage bytes have no approved paginated export reader'
  USING ERRCODE='42501'; END IF;

 SELECT pg_catalog.array_agg(schema_name||'.'||table_name ORDER BY schema_name,table_name)
 INTO v_expected FROM (VALUES
    ('public','v2_profiles'),
    ('public','v2_profile_settings'),
    ('public','v2_onboarding_progress'),
    ('public','v2_legal_acceptances'),
    ('public','v2_coach_threads'),
    ('public','v2_coach_messages'),
    ('public','v2_goals'),
    ('public','v2_goal_revisions'),
    ('public','v2_goal_revision_behavior_targets'),
    ('public','v2_event_group_memberships'),
    ('public','v2_event_participations'),
    ('allin_private','v2_health_considerations'),
    ('allin_private','v2_profile_settings_actions'),
    ('allin_private','v2_onboarding_actions'),
    ('allin_private','v2_account_deletion_requests'),
    ('allin_private','v2_account_deletion_execution_audit'),
    ('allin_private','v2_community_visibility'),
    ('allin_private','v2_goal_acceptance_actions'),
    ('allin_private','v2_goal_approval_reviews'),
    ('allin_private','v2_event_group_actions'),
    ('public','v2_training_session_instances'),
    ('public','v2_completed_activities'),
    ('public','v2_activity_sources'),
    ('public','v2_training_plans'),
    ('public','v2_training_plan_revisions'),
    ('public','v2_training_session_slots'),
    ('public','v2_training_revision_days'),
    ('public','v2_training_revision_sessions'),
    ('public','v2_training_execution_events'),
    ('public','v2_activity_metric_values'),
    ('public','v2_activity_segments'),
    ('public','v2_activity_strength_sets'),
    ('public','v2_activity_series'),
    ('public','v2_activity_route_objects'),
    ('public','v2_indoor_weekly_attempts'),
    ('public','v2_indoor_weekly_leaderboard'),
    ('public','v2_indoor_weekly_achievements'),
    ('allin_private','v2_training_action_receipts'),
    ('allin_private','v2_training_completion_outbox'),
    ('allin_private','v2_coach_message_actions'),
    ('allin_private','v2_training_plan_accept_receipts'),
    ('allin_private','v2_account_export_requests_candidate')
 ) AS reviewed(schema_name,table_name);
 SELECT pg_catalog.array_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname)
 INTO v_actual
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p');
 SELECT ARRAY(SELECT pg_catalog.unnest(v_expected)
   EXCEPT SELECT pg_catalog.unnest(v_actual)) INTO v_missing;
 SELECT ARRAY(SELECT pg_catalog.unnest(v_actual)
   EXCEPT SELECT pg_catalog.unnest(v_expected)) INTO v_unknown;
 IF pg_catalog.cardinality(v_missing)<>0 OR pg_catalog.cardinality(v_unknown)<>0
 THEN RAISE EXCEPTION 'Canonical owner tables changed: missing %, unknown %',
   v_missing,v_unknown USING ERRCODE='42501'; END IF;
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
     AND a.attname IN ('owner_id','athlete_id','actor_id','created_by_user_id')
     AND NOT EXISTS(
       SELECT 1 FROM pg_catalog.pg_attribute owned
       WHERE owned.attrelid=c.oid AND owned.attname='user_id'
         AND owned.attnum>0 AND NOT owned.attisdropped
     )
     AND NOT (
       n.nspname='allin_private' AND c.relname=ANY(ARRAY[
         'v2_community_pair_revisions','v2_community_follows',
         'v2_community_blocks','v2_community_action_receipts'
       ])
     )
 ) THEN RAISE EXCEPTION 'Unreviewed alternate-key owner table requires export coverage'
      USING ERRCODE='42501'; END IF;
 IF EXISTS (
   SELECT 1 FROM (VALUES
    ('v2_community_pair_revisions'),('v2_community_follows'),
    ('v2_community_blocks'),('v2_community_action_receipts')
   ) AS required(name)
   WHERE pg_catalog.to_regclass('allin_private.'||required.name) IS NULL
 ) OR EXISTS (
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='allin_private' AND c.relkind IN ('r','p')
     AND c.relname LIKE 'v2_community_%'
     AND c.relname <> ALL(ARRAY[
      'v2_community_visibility','v2_community_pair_revisions',
      'v2_community_follows','v2_community_blocks',
      'v2_community_action_receipts'])
 ) THEN RAISE EXCEPTION 'Community relationship inventory not approved'
    USING ERRCODE='42501'; END IF;
 -- This ID is bound to the exact PostgreSQL snapshot and export request.
 -- It MUST NOT be recomputed using a new transaction during staging.
 v_snapshot:=pg_catalog.md5(p_owner::text||':'||p_request::text||':'||
   pg_catalog.pg_current_snapshot()::text)::uuid;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_owner,'requestId',p_request,'snapshotId',v_snapshot,
  'collections',(SELECT pg_catalog.jsonb_agg(value ORDER BY value)
    FROM (
      SELECT pg_catalog.unnest(v_expected) AS value
      UNION ALL SELECT 'auth.users'
      UNION ALL SELECT 'community.outgoing_follows'
      UNION ALL SELECT 'community.incoming_follow_requests'
      UNION ALL SELECT 'community.outgoing_blocks'
      UNION ALL SELECT 'community.my_action_receipts'
    ) AS ordered),
  'ownerTableCount',pg_catalog.cardinality(v_expected),
  'snapshotIsRepeatableRead',true,
  'paginationReady',true,
  'privacyPending','community_pair_revisions_and_storage_media',
  'complete',false
 );
END;
$inventory$;

CREATE OR REPLACE FUNCTION public.v2_account_export_page_review_candidate(
 p_owner uuid,p_session uuid,p_request uuid,
 p_collection text,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $page$
DECLARE
 v_inventory jsonb;
 v_schema text;
 v_table text;
 v_column text:='user_id';
 v_offset integer;
 v_rows jsonb:='[]'::jsonb;
 v_item jsonb;
 v_number integer:=0;
 v_record_count integer:=0;
 v_query text;
 v_justified boolean:=false;
BEGIN
 v_inventory:=public.v2_account_export_inventory_review_candidate(
  p_owner,p_session,p_request);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>25 OR
    (p_cursor IS NOT NULL AND p_cursor !~ '^(0|[1-9][0-9]{0,6})$')
 THEN RAISE EXCEPTION 'Invalid account export page bound' USING ERRCODE='22023'; END IF;
 v_offset:=coalesce(p_cursor::integer,0);
 IF v_offset>2000000 THEN RAISE EXCEPTION 'Page cursor out of bounds' USING ERRCODE='22023'; END IF;
 IF p_collection IS NULL OR
    NOT (v_inventory->'collections' ? p_collection)
 THEN RAISE EXCEPTION 'Unreviewed account export collection' USING ERRCODE='42501'; END IF;
 IF p_collection='auth.users' THEN
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''id'',u.id,''email'',u.email,''created_at'',u.created_at,'||
    '''last_sign_in_at'',u.last_sign_in_at) FROM auth.users u '||
    'WHERE u.id=$1 ORDER BY u.id LIMIT $2 OFFSET $3';
 ELSIF p_collection LIKE 'community.%' THEN
  v_schema:='allin_private';
  IF p_collection='community.outgoing_follows' THEN
   v_table:='v2_community_follows'; v_column:='follower_id';
  ELSIF p_collection='community.incoming_follow_requests' THEN
   v_table:='v2_community_follows'; v_column:='followed_id';
  ELSIF p_collection='community.outgoing_blocks' THEN
   v_table:='v2_community_blocks'; v_column:='blocker_id';
  ELSIF p_collection='community.my_action_receipts' THEN
   v_table:='v2_community_action_receipts'; v_column:='actor_id';
  ELSE RAISE EXCEPTION 'Unknown reviewed Community relation' USING ERRCODE='42501'; END IF;
  IF p_collection='community.incoming_follow_requests' THEN
   v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''follower_id'',t.follower_id,''state'',t.state,'||
    '''requested_at'',t.requested_at,''approved_at'',t.approved_at) '||
    'FROM allin_private.v2_community_follows t WHERE t.followed_id=$1 '||
    'ORDER BY t.follower_id LIMIT $2 OFFSET $3';
  ELSE
   v_query:=pg_catalog.format('SELECT pg_catalog.to_jsonb(t) FROM %I.%I t '||
    'WHERE t.%I=$1 ORDER BY pg_catalog.to_jsonb(t)::text LIMIT $2 OFFSET $3',
    v_schema,v_table,v_column);
  END IF;
 ELSE
  v_schema:=pg_catalog.split_part(p_collection,'.',1);
  v_table:=pg_catalog.split_part(p_collection,'.',2);
  IF v_schema NOT IN ('public','allin_private') OR v_table IS NULL
    OR v_table='' OR pg_catalog.split_part(p_collection,'.',3)<>''
  THEN RAISE EXCEPTION 'Invalid owner collection' USING ERRCODE='42501'; END IF;
  v_query:=pg_catalog.format('SELECT pg_catalog.to_jsonb(t) FROM %I.%I t '||
    'WHERE t.user_id=$1 ORDER BY pg_catalog.to_jsonb(t)::text LIMIT $2 OFFSET $3',
    v_schema,v_table);
 END IF;
 FOR v_item IN EXECUTE v_query USING p_owner,p_limit+1,v_offset LOOP
  v_number:=v_number+1;
  IF v_number<=p_limit THEN
    v_rows:=v_rows||pg_catalog.jsonb_build_array(v_item);
    v_record_count:=v_record_count+1;
  END IF;
 END LOOP;
 IF pg_catalog.octet_length(v_rows::text)>1000000 THEN
  RAISE EXCEPTION 'Account export page exceeds encrypted writer limit'
   USING ERRCODE='54000'; END IF;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_owner,'requestId',p_request,'collection',p_collection,
  'snapshotId',v_inventory->>'snapshotId',
  'ownerVerified',true,'rows',v_rows,'done',v_number<=p_limit,
  'nextCursor',CASE WHEN v_number<=p_limit THEN NULL
   ELSE (v_offset+v_record_count)::text END,
  'completeUserExport',false);
END;
$page$;

REVOKE ALL ON FUNCTION
 public.v2_account_export_inventory_review_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 public.v2_account_export_page_review_candidate(uuid,uuid,uuid,text,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
-- This permission exists ONLY when applying this review file to a disposable
-- DB. Production installation requires independent explicit approval.
GRANT EXECUTE ON FUNCTION
 public.v2_account_export_inventory_review_candidate(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION
 public.v2_account_export_page_review_candidate(uuid,uuid,uuid,text,text,integer)
 TO service_role;
COMMIT;
