-- ALL-251 / ALL-222 REVIEW-ONLY direct Auth owner-cascade compatibility.
-- NOT A MIGRATION. Never apply to hosted V2 without owner/security approval.
-- Existing ALL-251 deletion-claim preflight requires a direct user_id FK
-- to auth.users with ON DELETE CASCADE for EVERY user-owned table. Indirect
-- parent cascades alone are insufficient. This candidate closes that gap.
DO $direct_owner$
DECLARE
 edge record;
 v_target regclass;
 v_auth regclass:='auth.users'::regclass;
 v_user_column smallint;
BEGIN
 FOR edge IN SELECT * FROM (VALUES
  ('public','v2_training_plan_revisions'),
  ('public','v2_training_session_slots'),
  ('public','v2_training_revision_days'),
  ('public','v2_training_revision_sessions'),
  ('public','v2_training_execution_events'),
  ('allin_private','v2_training_completion_outbox'),
  ('public','v2_activity_metric_values'),
  ('public','v2_activity_segments'),
  ('public','v2_activity_strength_sets'),
  ('public','v2_activity_series'),
  ('public','v2_activity_route_objects'),
  ('public','v2_indoor_weekly_achievements')
 ) AS x(schema_name,table_name)
 LOOP
   v_target:=pg_catalog.to_regclass(
     pg_catalog.format('%I.%I',edge.schema_name,edge.table_name));
   IF v_target IS NULL THEN
     RAISE EXCEPTION 'Missing owner table %.%',edge.schema_name,edge.table_name;
   END IF;
   SELECT attnum INTO v_user_column FROM pg_catalog.pg_attribute
    WHERE attrelid=v_target AND attname='user_id'
      AND NOT attisdropped AND attnum>0 AND attnotnull;
   IF v_user_column IS NULL THEN
     RAISE EXCEPTION 'Owner column user_id missing/nullable in %.%',
       edge.schema_name,edge.table_name;
   END IF;
   IF EXISTS (
     SELECT 1 FROM pg_catalog.pg_constraint fk
     WHERE fk.conrelid=v_target AND fk.confrelid=v_auth
       AND fk.contype='f' AND fk.confdeltype='c'
       AND fk.conkey=ARRAY[v_user_column]::smallint[]
   ) THEN CONTINUE; END IF;
   EXECUTE pg_catalog.format(
     'ALTER TABLE %I.%I ADD CONSTRAINT v2_owner_auth_cascade_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
       edge.schema_name,edge.table_name);
 END LOOP;
END $direct_owner$;
-- Do NOT weaken the existing ALL-251 deletion claim preflight or let the
-- database cascade replace Storage cleanup and delete completion receipts.
