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
    ('allin_private','v2_coach_turn_claims'),
    ('allin_private','v2_training_plan_accept_receipts'),
    ('allin_private','v2_account_export_requests_candidate')
    -- ALL-247 Food Log/Hydration candidate projections exist below, but
    -- their four owner tables are not registered until ALL-222/247/251
    -- approve the shared canonical export source and privacy contract.
    -- See ALL-247-ALL-251-fuel-privacy-preflight.review.sql:
    -- export_registered=false; the active 42-table inventory must fail
    -- closed if any of those candidate owner tables are introduced.
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
 -- Billing source identity is owner_id; event receipts join by purchase_id.
 -- Missing even one relation refuses a supposed full billing-domain export.
 IF EXISTS (
   SELECT 1 FROM (VALUES
    ('allin_private.v2_subscription_checkout_attempts'),
    ('allin_private.v2_subscription_purchases'),
    ('allin_private.v2_subscription_verified_events')
   ) AS required(name)
   WHERE pg_catalog.to_regclass(required.name) IS NULL
 ) THEN RAISE EXCEPTION 'Billing export source graph is incomplete'
    USING ERRCODE='42501'; END IF;
 -- This ID is bound to the exact PostgreSQL snapshot and export request.
 -- It MUST NOT be recomputed using a new transaction during staging.
 v_snapshot:=pg_catalog.md5(p_owner::text||':'||p_request::text||':'||
   pg_catalog.pg_current_snapshot()::text)::uuid;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_owner,'requestId',p_request,'snapshotId',v_snapshot,
  'collections',(SELECT pg_catalog.jsonb_agg(value ORDER BY value)
    FROM (
      SELECT owner_collection AS value
        FROM pg_catalog.unnest(v_expected) AS reviewed(owner_collection)
       WHERE owner_collection <> 'allin_private.v2_coach_turn_claims'
      UNION ALL SELECT 'auth.users'
      UNION ALL SELECT 'community.outgoing_follows'
      UNION ALL SELECT 'community.incoming_follow_requests'
      UNION ALL SELECT 'community.outgoing_blocks'
      UNION ALL SELECT 'community.my_action_receipts'
      UNION ALL SELECT 'billing.checkout_attempts'
      UNION ALL SELECT 'billing.purchases'
      UNION ALL SELECT 'billing.verified_events'
    ) AS ordered),
  'ownerTableCount',pg_catalog.cardinality(v_expected),
  'internalOperationalTables',pg_catalog.jsonb_build_array(
    'allin_private.v2_coach_turn_claims'),
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
 ELSIF p_collection LIKE 'billing.%' THEN
  IF p_collection='billing.checkout_attempts' THEN
   v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''attemptId'',t.attempt_id,''provider'',t.provider,'||
    '''environment'',t.environment,''offerKind'',t.offer_kind,'||
    '''state'',t.state,''verifiedAt'',t.verified_at)'||
    ' FROM allin_private.v2_subscription_checkout_attempts t'||
    ' WHERE t.owner_id=$1 ORDER BY t.attempt_id LIMIT $2 OFFSET $3';
  ELSIF p_collection='billing.purchases' THEN
   v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''purchaseId'',t.id,''checkoutAttemptId'',t.checkout_attempt_id,'||
    '''provider'',t.provider,''environment'',t.environment,'||
    '''phase'',t.phase,''revision'',t.revision,'||
    '''accessUntil'',t.access_until,''updatedAt'',t.updated_at)'||
    ' FROM allin_private.v2_subscription_purchases t'||
    ' WHERE t.owner_id=$1 ORDER BY t.id LIMIT $2 OFFSET $3';
  ELSIF p_collection='billing.verified_events' THEN
   v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''purchaseId'',e.purchase_id,''provider'',e.provider,'||
    '''environment'',e.environment,''revision'',e.revision,'||
    '''acceptedAt'',e.accepted_at)'||
    ' FROM allin_private.v2_subscription_verified_events e'||
    ' JOIN allin_private.v2_subscription_purchases t ON t.id=e.purchase_id'||
    ' WHERE t.owner_id=$1 ORDER BY e.purchase_id,e.revision LIMIT $2 OFFSET $3';
  ELSE RAISE EXCEPTION 'Unknown billing export projection' USING ERRCODE='42501'; END IF;
 ELSIF p_collection='public.v2_food_log_entries' THEN
  -- ALL-247 REVIEW ONLY / NOT REGISTERED. Portability includes tombstones
  -- and original entered energy source; the real registry rejects this
  -- collection until canonical owner and retention approval.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''id'',e.id,''user_id'',e.user_id,'||
    '''consumed_at'',e.consumed_at,''local_date'',e.local_date,'||
    '''timezone_name'',e.timezone_name,''meal_slot'',e.meal_slot,'||
    '''label'',e.label,''quantity'',e.quantity,''unit'',e.unit,'||
    '''kcal'',e.kcal,''nutrition_source'',e.nutrition_source,'||
    '''revision'',e.revision,''created_at'',e.created_at,'||
    '''updated_at'',e.updated_at,''deleted_at'',e.deleted_at) '||
    'FROM public.v2_food_log_entries e '||
    'WHERE e.user_id=$1 ORDER BY e.consumed_at,e.id LIMIT $2 OFFSET $3';
 ELSIF p_collection='public.v2_hydration_events' THEN
  -- Preserve distinct refill and drink events; do not infer consumption.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''id'',h.id,''user_id'',h.user_id,''occurred_at'',h.occurred_at,'||
    '''local_date'',h.local_date,''timezone_name'',h.timezone_name,'||
    '''event_kind'',h.event_kind,''source_platform'',h.source_platform,'||
    '''source_name'',h.source_name,''confidence'',h.confidence,'||
    '''original_volume'',h.original_volume,''original_unit'',h.original_unit,'||
    '''volume_ml'',h.volume_ml,''revision'',h.revision,'||
    '''created_at'',h.created_at,''updated_at'',h.updated_at,'||
    '''deleted_at'',h.deleted_at) FROM public.v2_hydration_events h '||
    'WHERE h.user_id=$1 ORDER BY h.occurred_at,h.id LIMIT $2 OFFSET $3';
 ELSIF p_collection IN ('allin_private.v2_food_log_write_actions',
                        'allin_private.v2_hydration_actions') THEN
  -- Owner-portable receipts, NOT internal replay/fingerprint secrets.
  IF p_collection='allin_private.v2_food_log_write_actions' THEN
   v_query:='SELECT pg_catalog.jsonb_build_object('||
     '''user_id'',a.user_id,''action_id'',a.action_id,'||
     '''result_id'',a.result_id,''result_revision'',a.result_revision,'||
     '''created_at'',a.created_at) '||
     'FROM allin_private.v2_food_log_write_actions a '||
     'WHERE a.user_id=$1 ORDER BY a.created_at,a.action_id LIMIT $2 OFFSET $3';
  ELSE
   v_query:='SELECT pg_catalog.jsonb_build_object('||
     '''user_id'',a.user_id,''action_id'',a.action_id,'||
     '''result_id'',a.result_id,''result_revision'',a.result_revision,'||
     '''created_at'',a.created_at) '||
     'FROM allin_private.v2_hydration_actions a '||
     'WHERE a.user_id=$1 ORDER BY a.created_at,a.action_id LIMIT $2 OFFSET $3';
  END IF;
 ELSIF p_collection='community.my_posts' THEN
  -- REVIEW-ONLY / NOT REGISTERED: this owner-only projection is intentionally
  -- unreachable through the current inventory allowlist. Activating it
  -- requires separate Community source, media and privacy acceptance.
  -- Never use the public-feed reader or infer another athlete's posts.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''id'',p.id,''owner_id'',p.owner_id,''kind'',p.kind,'||
    '''audience'',p.audience,''title'',p.title,''body'',p.body,'||
    '''source_id'',p.source_id,''post_version'',p.post_version,'||
    '''published_at'',p.published_at,''updated_at'',p.updated_at) '||
    'FROM allin_private.v2_community_posts p '||
    'WHERE p.owner_id=$1 ORDER BY p.published_at,p.id LIMIT $2 OFFSET $3';
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
    'AND NOT EXISTS (SELECT 1 FROM allin_private.v2_community_blocks b '||
    'WHERE (b.blocker_id=t.follower_id AND b.blocked_id=$1) '||
    'OR (b.blocker_id=$1 AND b.blocked_id=t.follower_id)) '||
    'ORDER BY t.follower_id LIMIT $2 OFFSET $3';
  ELSIF p_collection='community.my_action_receipts' THEN
   -- An athlete may export their own action history, not internal pair CAS
   -- versions, replay hashes or other person's private block decisions.
   v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''action_id'',t.action_id,''action'',t.action,'||
    '''target_id'',t.target_id,''created_at'',t.created_at) '||
    'FROM allin_private.v2_community_action_receipts t '||
    'WHERE t.actor_id=$1 ORDER BY t.created_at,t.action_id LIMIT $2 OFFSET $3';
  ELSE
   v_query:=pg_catalog.format('SELECT pg_catalog.to_jsonb(t) FROM %I.%I t '||
    'WHERE t.%I=$1 ORDER BY pg_catalog.to_jsonb(t)::text LIMIT $2 OFFSET $3',
    v_schema,v_table,v_column);
  END IF;
 ELSIF p_collection='public.v2_training_athlete_restrictions' THEN
  -- ALL-230 / ALL-251 REVIEW ONLY / NOT INVENTORIED.
  -- The athlete's own active AND retired restrictions are portable; no
  -- unapproved client RPC or Training writer grant follows from this code.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''id'',t.id,''user_id'',t.user_id,''category'',t.category,'||
    '''subject'',t.subject,''source'',t.source,''status'',t.status,'||
    '''source_ref'',t.source_ref,''revision'',t.revision,'||
    '''created_at'',t.created_at,''updated_at'',t.updated_at) '||
    'FROM public.v2_training_athlete_restrictions t '||
    'WHERE t.user_id=$1 ORDER BY t.created_at,t.id LIMIT $2 OFFSET $3';
 ELSIF p_collection='allin_private.v2_training_restriction_certifications' THEN
  -- The certification is portable owner data; no private source tokens.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''user_id'',t.user_id,''certified_revision'',t.certified_revision,'||
    '''inventory_digest'',t.inventory_digest,''certified_at'',t.certified_at) '||
    'FROM allin_private.v2_training_restriction_certifications t '||
    'WHERE t.user_id=$1 ORDER BY t.certified_at,t.user_id LIMIT $2 OFFSET $3';
 ELSIF p_collection='allin_private.v2_training_restriction_action_receipts' THEN
  -- Exact-action history is user-portable, but the idempotency request hash
  -- is operational data and never enters a downloadable account archive.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''user_id'',t.user_id,''action_id'',t.action_id,'||
    '''result_revision'',t.result_revision,''created_at'',t.created_at) '||
    'FROM allin_private.v2_training_restriction_action_receipts t '||
    'WHERE t.user_id=$1 ORDER BY t.created_at,t.action_id LIMIT $2 OFFSET $3';
 ELSIF p_collection='allin_private.v2_coach_budget_periods' THEN
  -- Show athlete's actual budget accounting; no provider secrets or
  -- privileged process metadata. Financial totals are server owned.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''user_id'',t.user_id,''period_start'',t.period_start,'||
    '''cap_usd'',t.cap_usd,''held_usd'',t.held_usd,'||
    '''spent_usd'',t.spent_usd) '||
    'FROM allin_private.v2_coach_budget_periods t '||
    'WHERE t.user_id=$1 ORDER BY t.period_start LIMIT $2 OFFSET $3';
 ELSIF p_collection='allin_private.v2_coach_budget_reservations' THEN
  -- Never export internal reservation identifiers or replay correlation.
  -- Usage counts and reviewed accounting are athlete-owned.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''user_id'',t.user_id,''period_start'',t.period_start,'||
    '''maximum_usd'',t.maximum_usd,'||
    '''output_token_limit'',t.output_token_limit,'||
    '''status'',t.status,''metered_input_tokens'',t.metered_input_tokens,'||
    '''metered_output_tokens'',t.metered_output_tokens,'||
    '''settled_usd'',t.settled_usd,''created_at'',t.created_at,'||
    '''settled_at'',t.settled_at) '||
    'FROM allin_private.v2_coach_budget_reservations t '||
    'WHERE t.user_id=$1 ORDER BY t.created_at,t.client_request_id LIMIT $2 OFFSET $3';
 ELSIF p_collection='allin_private.v2_account_export_requests_candidate' THEN
  -- An export is a user-facing data portability artifact. The internal
  -- Auth session ID must never be serialized from the worker request ledger.
  -- Preserve owner and request provenance while redacting bearer-linked
  -- operational state. This table is still counted by the owner inventory.
  v_query:='SELECT pg_catalog.jsonb_build_object('||
    '''user_id'',t.user_id,''request_id'',t.request_id,'||
    '''status'',t.status,''requested_at'',t.requested_at,'||
    '''updated_at'',t.updated_at,''expires_at'',t.expires_at) '||
    'FROM allin_private.v2_account_export_requests_candidate t '||
    'WHERE t.user_id=$1 ORDER BY t.requested_at,t.request_id LIMIT $2 OFFSET $3';
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
