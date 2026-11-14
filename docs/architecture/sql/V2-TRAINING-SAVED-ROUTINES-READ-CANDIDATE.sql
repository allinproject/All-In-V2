-- ALL-246 / ALL-222 review-only Saved Routine read functions.
-- Depends on V2-TRAINING-SAVED-ROUTINES-OWNER-CANDIDATE.sql.
-- NO CLIENT EXECUTE GRANTS. NOT A MIGRATION OR LIVE ENDPOINT.
-- RLS remains enabled and no direct table permissions are granted.
BEGIN;
CREATE FUNCTION public.v2_training_routines_list_candidate(
 p_expected_user_id uuid,p_session_generation bigint,p_cursor uuid,
 p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $read$
DECLARE v_epoch bigint;v_rows jsonb;v_last uuid;v_more boolean;
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 IF p_session_generation IS NULL OR p_session_generation<0 OR
   p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid Routine read window' USING ERRCODE='22023'; END IF;
 SELECT coalesce(e.epoch,0) INTO v_epoch
 FROM (SELECT p_expected_user_id AS user_id) x
 LEFT JOIN allin_private.v2_training_routine_owner_epochs e
   ON e.user_id=x.user_id;
 WITH selected AS (
  SELECT r.id,r.user_id,r.current_version,r.updated_at,r.is_favorite,
    v.name,v.sport
  FROM public.v2_training_routines r
  JOIN public.v2_training_routine_versions v
    ON v.routine_id=r.id AND v.user_id=r.user_id
      AND v.version=r.current_version
  WHERE r.user_id=p_expected_user_id AND r.archived_at IS NULL
    AND (p_cursor IS NULL OR r.id>p_cursor)
  ORDER BY r.id LIMIT p_limit
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'routineId',id,'ownerId',user_id,'version',current_version,
  'name',name,'sport',sport,'updatedAt',updated_at,
  'isFavorite',is_favorite) ORDER BY id),'[]'::jsonb),
  max(id) INTO v_rows,v_last FROM selected;
 SELECT EXISTS(
  SELECT 1 FROM public.v2_training_routines r
  WHERE r.user_id=p_expected_user_id AND r.archived_at IS NULL
   AND (p_cursor IS NULL OR r.id>p_cursor)
   AND (v_last IS NULL OR r.id>v_last)
 ) INTO v_more;
 -- Epoch changes on every canonical mutation. The client requires the SAME
 -- snapshotVersion across all pages, rather than mistaking partial reads
 -- for an empty saved library.
 RETURN pg_catalog.jsonb_build_object(
  'expectedOwnerId',p_expected_user_id,
  'sessionGeneration',p_session_generation,
  'snapshotVersion','routine-epoch:'||v_epoch::text,
  'records',v_rows,'hasMore',v_more,
  'nextCursor',CASE WHEN v_more THEN v_last::text ELSE NULL END
 );
END;
$read$;

CREATE FUNCTION public.v2_training_routine_version_candidate(
 p_expected_user_id uuid,p_session_generation bigint,
 p_routine_id uuid,p_version bigint
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $detail$
DECLARE v_read jsonb;
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 IF p_session_generation IS NULL OR p_session_generation<0 OR
   p_routine_id IS NULL OR p_version IS NULL OR p_version<1 THEN
  RAISE EXCEPTION 'Invalid exact Routine version request' USING ERRCODE='22023'; END IF;
 SELECT pg_catalog.jsonb_build_object(
  'identity','canonical_saved_routine',
  'routineId',v.routine_id,'ownerId',v.user_id,'version',v.version,
  'sessionGeneration',p_session_generation,
  'name',v.name,'sport',v.sport,'notes',v.notes,
  'complete',true,'blocks',v.blocks
 ) INTO v_read
 FROM public.v2_training_routine_versions v
 JOIN public.v2_training_routines r
  ON r.id=v.routine_id AND r.user_id=v.user_id
 WHERE v.user_id=p_expected_user_id
   AND v.routine_id=p_routine_id AND v.version=p_version
   AND r.archived_at IS NULL;
 RETURN v_read;
END;
$detail$;
REVOKE ALL ON FUNCTION public.v2_training_routines_list_candidate(
 uuid,bigint,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_training_routine_version_candidate(
 uuid,bigint,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
