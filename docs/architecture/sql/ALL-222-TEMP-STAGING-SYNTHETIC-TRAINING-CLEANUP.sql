-- ALL-222 temporary staging only; disposable Auth test fixture cleanup.
-- This function never deletes users, Storage objects, real domain rows or starts
-- account deletion. It only removes the Training FK children that block GoTrue
-- admin deletion of an independently authenticated synthetic staging test user.
-- Never deploy to canonical V2 or production.
DO $preflight$
BEGIN
 IF to_regprocedure('public.v2_all222_cleanup_synthetic_training_fixture(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Concurrent cleanup helper already exists; review it first';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM allin_private.v2_account_deletion_processor_config WHERE execution_enabled=false) THEN
  RAISE EXCEPTION 'Account deletion worker gate must remain disabled';
 END IF;
END $preflight$;

CREATE FUNCTION public.v2_all222_cleanup_synthetic_training_fixture(p_expected_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
 v_account auth.users%rowtype;
 v_receipts integer := 0;
 v_events integer := 0;
 v_outbox integer := 0;
 v_session_count integer := 0;
BEGIN
 IF p_expected_user_id IS NULL THEN
  RAISE EXCEPTION 'Synthetic cleanup requires expected ID' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_account FROM auth.users
 WHERE id=p_expected_user_id
 FOR UPDATE;
 IF NOT FOUND THEN
  -- Idempotent cleanup retry after Auth admin user deletion.
  RETURN pg_catalog.jsonb_build_object('status','absent');
 END IF;
 IF v_account.email NOT LIKE 'all251-%@example.invalid'
    OR v_account.raw_user_meta_data->>'all251_synthetic_only' IS DISTINCT FROM 'true'
    OR v_account.created_at < pg_catalog.now() - interval '4 hours'
 THEN
  RAISE EXCEPTION 'Not a recent approved synthetic staging account'
    USING ERRCODE='42501';
 END IF;
 IF EXISTS (SELECT 1 FROM public.v2_completed_activities
            WHERE user_id=p_expected_user_id)
 THEN
  RAISE EXCEPTION 'Unexpected Completed Activity: manual review required'
    USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO v_session_count
 FROM public.v2_training_session_instances WHERE user_id=p_expected_user_id;
 IF v_session_count>5 THEN
  RAISE EXCEPTION 'Unexpected Training session count: manual review required'
   USING ERRCODE='42501';
 END IF;
 DELETE FROM allin_private.v2_training_action_receipts
 WHERE user_id=p_expected_user_id;
 GET DIAGNOSTICS v_receipts = ROW_COUNT;
 DELETE FROM allin_private.v2_training_completion_outbox
 WHERE user_id=p_expected_user_id;
 GET DIAGNOSTICS v_outbox = ROW_COUNT;
 DELETE FROM public.v2_training_execution_events
 WHERE user_id=p_expected_user_id;
 GET DIAGNOSTICS v_events = ROW_COUNT;
 DELETE FROM public.v2_training_session_instances
 WHERE user_id=p_expected_user_id;
 RETURN pg_catalog.jsonb_build_object(
  'status','training_dependents_removed',
  'receipts',v_receipts,'events',v_events,'outbox',v_outbox,
  'training_sessions',v_session_count
 );
END;
$fn$;
REVOKE ALL ON FUNCTION public.v2_all222_cleanup_synthetic_training_fixture(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.v2_all222_cleanup_synthetic_training_fixture(uuid) TO service_role;
