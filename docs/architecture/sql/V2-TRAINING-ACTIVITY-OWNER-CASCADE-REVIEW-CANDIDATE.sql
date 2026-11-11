-- ALL-251 / ALL-222 REVIEW ONLY. Candidate for owner-deletion FK cascades.
-- NOT A MIGRATION. Only used in a disposable PG17 account-deletion replay.
-- Do NOT apply to hosted Supabase or enable account deletion processing.
--
-- This selects explicitly enumerated child -> parent ownership FKs. It does
-- not blanket-cascade metric definitions or global challenge definitions.
-- Test and review behavior for ordinary parent deletion before deployment.
DO $cascade$
DECLARE
 edge record;
 v_oid oid;
 v_count integer;
 v_name text;
 v_def text;
 v_child text;
BEGIN
 FOR edge IN
 SELECT * FROM (VALUES
 ('allin_private','v2_training_action_receipts','public','v2_training_session_instances'),
 ('public','v2_training_execution_events','public','v2_training_session_instances'),
 ('allin_private','v2_training_completion_outbox','public','v2_training_session_instances'),
 ('public','v2_completed_activities','public','v2_training_session_instances'),
 ('public','v2_training_plan_revisions','public','v2_training_plans'),
 ('public','v2_training_session_slots','public','v2_training_plans'),
 ('public','v2_training_revision_days','public','v2_training_plan_revisions'),
 ('public','v2_training_revision_sessions','public','v2_training_plan_revisions'),
 ('public','v2_training_revision_sessions','public','v2_training_session_slots'),
 ('public','v2_training_revision_sessions','public','v2_training_revision_days'),
 ('public','v2_training_session_instances','public','v2_training_revision_sessions'),
 ('public','v2_activity_metric_values','public','v2_completed_activities'),
 ('public','v2_activity_metric_values','public','v2_activity_sources'),
 ('public','v2_activity_segments','public','v2_completed_activities'),
 ('public','v2_activity_segments','public','v2_activity_segments'),
 ('public','v2_activity_segments','public','v2_activity_sources'),
 ('public','v2_activity_strength_sets','public','v2_completed_activities'),
 ('public','v2_activity_strength_sets','public','v2_activity_segments'),
 ('public','v2_activity_strength_sets','public','v2_activity_sources'),
 ('public','v2_activity_series','public','v2_completed_activities'),
 ('public','v2_activity_series','public','v2_activity_sources'),
 ('public','v2_activity_series','public','v2_activity_segments'),
 ('public','v2_activity_route_objects','public','v2_completed_activities'),
 ('public','v2_activity_route_objects','public','v2_activity_sources'),
 ('public','v2_indoor_weekly_attempts','public','v2_completed_activities'),
 ('public','v2_indoor_weekly_leaderboard','public','v2_indoor_weekly_attempts'),
 ('public','v2_indoor_weekly_achievements','public','v2_indoor_weekly_leaderboard')
 ) AS e(child_schema,child_name,parent_schema,parent_name)
 LOOP
  SELECT count(*),min(c.oid) INTO v_count,v_oid
  FROM pg_catalog.pg_constraint c
  WHERE c.contype='f'
    AND c.conrelid=pg_catalog.to_regclass(
      pg_catalog.format('%I.%I',edge.child_schema,edge.child_name))
    AND c.confrelid=pg_catalog.to_regclass(
      pg_catalog.format('%I.%I',edge.parent_schema,edge.parent_name));
  IF v_count<>1 THEN
    RAISE EXCEPTION 'Expected exactly one FK %.% -> %.%, got %',
     edge.child_schema,edge.child_name,edge.parent_schema,edge.parent_name,v_count;
  END IF;
  SELECT c.conname,pg_catalog.pg_get_constraintdef(c.oid,true)
    INTO v_name,v_def FROM pg_catalog.pg_constraint c WHERE c.oid=v_oid;
  IF v_def ~* 'ON DELETE' OR v_def ~* 'DEFERRABLE' THEN
    RAISE EXCEPTION 'Explicit FK review needed for %.%: %',
      edge.child_schema,edge.child_name,v_def;
  END IF;
  v_child:=pg_catalog.format('%I.%I',edge.child_schema,edge.child_name);
  EXECUTE pg_catalog.format('ALTER TABLE %s DROP CONSTRAINT %I',v_child,v_name);
  EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE',
    v_child,v_name,v_def);
 END LOOP;
END $cascade$;
-- The active-plan current revision owner pointer and accepted/superseded
-- immutable-history trigger require separate explicit lifecycle policy.
-- They are deliberately NOT rewritten by this FK-only candidate.
