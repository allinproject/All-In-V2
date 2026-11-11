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
 v_expected_count integer;
 v_actual_count integer;
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
 -- Detect new domain-owned tables before returning an incomplete export.
 SELECT count(*) INTO v_actual_count FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND
   a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')
 AND (c.relname LIKE 'v2_training%' OR c.relname LIKE 'v2_completed%'
    OR c.relname LIKE 'v2_activity_%' OR c.relname LIKE 'v2_indoor_weekly%');
 v_expected_count:=20;
 IF v_actual_count<>v_expected_count THEN
  RAISE EXCEPTION 'Unknown owner table requires explicit export review: expected %, found %',
   v_expected_count,v_actual_count USING ERRCODE='42501'; END IF;
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
