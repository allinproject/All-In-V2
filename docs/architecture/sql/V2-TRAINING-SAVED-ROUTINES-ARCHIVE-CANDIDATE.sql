-- ALL-246 / ALL-222 / ALL-251 REVIEW ONLY: private Saved Routine archive.
-- Depends on V2-TRAINING-SAVED-ROUTINES-OWNER-CANDIDATE.sql.
-- NOT deployed, NOT a migration, no client or service EXECUTE grants.
-- Archive removes a template from active library; it DOES NOT delete
-- Completed Activities, accepted Training plans or immutable routine versions.
BEGIN;
-- Deliberate domain-version conflicts use non-retryable PostgREST PT409.
-- SQLSTATE 40001 is reserved for genuine transactional serialization failures.
CREATE FUNCTION allin_private.v2_training_routine_archive_candidate(
 p_expected_user_id uuid,p_routine_id uuid,p_expected_version bigint,p_action_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $archive$
DECLARE v_existing allin_private.v2_training_routine_actions%ROWTYPE;
 v_digest text;v_version bigint;
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 IF p_routine_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR
    p_action_id IS NULL THEN
  RAISE EXCEPTION 'Invalid Routine archive request' USING ERRCODE='22023'; END IF;
 v_digest:=pg_catalog.md5(pg_catalog.jsonb_build_object(
  'operation','archive','routineId',p_routine_id,
  'expectedVersion',p_expected_version)::text);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('routine:'||p_expected_user_id::text,0));
 SELECT * INTO v_existing FROM allin_private.v2_training_routine_actions
  WHERE user_id=p_expected_user_id AND action_id=p_action_id;
 IF FOUND THEN
  IF v_existing.payload_digest<>v_digest OR v_existing.routine_id<>p_routine_id
    OR v_existing.result_version<>p_expected_version THEN
   RAISE EXCEPTION 'Conflicting Routine archive replay' USING ERRCODE='23505'; END IF;
  RETURN pg_catalog.jsonb_build_object('routineId',p_routine_id,
   'version',p_expected_version,'archived',true,'replayed',true);
 END IF;
 SELECT r.current_version INTO v_version
  FROM public.v2_training_routines r
  WHERE r.id=p_routine_id AND r.user_id=p_expected_user_id
    AND r.archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Routine inaccessible' USING ERRCODE='42501'; END IF;
 IF v_version<>p_expected_version THEN
  RAISE EXCEPTION 'Routine version changed' USING ERRCODE='PT409'; END IF;
 UPDATE public.v2_training_routines SET archived_at=now(),updated_at=now()
  WHERE id=p_routine_id AND user_id=p_expected_user_id
    AND current_version=p_expected_version AND archived_at IS NULL;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Routine archive conflict' USING ERRCODE='PT409'; END IF;
 INSERT INTO allin_private.v2_training_routine_owner_epochs(user_id,epoch)
 VALUES(p_expected_user_id,1)
 ON CONFLICT(user_id) DO UPDATE
  SET epoch=allin_private.v2_training_routine_owner_epochs.epoch+1;
 INSERT INTO allin_private.v2_training_routine_actions
  (user_id,action_id,payload_digest,routine_id,result_version)
 VALUES(p_expected_user_id,p_action_id,v_digest,p_routine_id,p_expected_version);
 RETURN pg_catalog.jsonb_build_object('routineId',p_routine_id,
  'version',p_expected_version,'archived',true,'replayed',false);
END;
$archive$;
REVOKE ALL ON FUNCTION allin_private.v2_training_routine_archive_candidate(
 uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
