-- ALL-246 / ALL-251 REVIEW ONLY. NOT A MIGRATION / EXPORT ENTRYPOINT.
-- This is a PRIVATE scoped fragment for the EXISTING canonical ALL-251
-- owner export. It must be co-registered after the full Routine schema is
-- applied in an isolated complete Training graph; no API grant is given.
-- Never claim this fragment alone fulfills the user's complete account export.
BEGIN;
CREATE FUNCTION allin_private.v2_training_routine_export_fragment_candidate(
 p_expected_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $export$
DECLARE v_routines jsonb;v_versions jsonb;v_epochs jsonb;v_actions jsonb;
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.id),'[]'::jsonb)
  INTO v_routines FROM public.v2_training_routines r
  WHERE r.user_id=p_expected_user_id;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v)
  ORDER BY v.routine_id,v.version),'[]'::jsonb)
  INTO v_versions FROM public.v2_training_routine_versions v
  WHERE v.user_id=p_expected_user_id;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) ORDER BY e.user_id),'[]'::jsonb)
  INTO v_epochs FROM allin_private.v2_training_routine_owner_epochs e
  WHERE e.user_id=p_expected_user_id;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.action_id),'[]'::jsonb)
  INTO v_actions FROM allin_private.v2_training_routine_actions a
  WHERE a.user_id=p_expected_user_id;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_expected_user_id,'schemaVersion',1,
  'records',pg_catalog.jsonb_build_object(
   'public.v2_training_routines',v_routines,
   'public.v2_training_routine_versions',v_versions,
   'allin_private.v2_training_routine_owner_epochs',v_epochs,
   'allin_private.v2_training_routine_actions',v_actions),
  'recordCount',
   pg_catalog.jsonb_array_length(v_routines)+pg_catalog.jsonb_array_length(v_versions)+
   pg_catalog.jsonb_array_length(v_epochs)+pg_catalog.jsonb_array_length(v_actions),
  'completeAccountExport',false);
END;
$export$;
REVOKE ALL ON FUNCTION allin_private.v2_training_routine_export_fragment_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
