-- ALL-246/ALL-222 REVIEW ONLY — narrow authenticated Routine gateway.
-- Only for isolated Auth-compatible PG17 and later an EXPLICITLY approved
-- staging schema. NOT a migration; DO NOT apply to live/shared Supabase.
-- Four owner RPCs; no direct access to Routine tables/private helpers.
-- Authenticated role grants here are limited to these four named functions.
BEGIN;

-- Existing private owner check requires matching auth.uid(), an active session
-- in auth.sessions and an existing V2 profile on every call.
CREATE FUNCTION public.v2_training_routine_list_owner_candidate(
 p_expected_user_id uuid,p_session_generation bigint,p_cursor uuid,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $gateway$
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 RETURN public.v2_training_routines_list_candidate(
  p_expected_user_id,p_session_generation,p_cursor,p_limit);
END;
$gateway$;
CREATE FUNCTION public.v2_training_routine_read_owner_candidate(
 p_expected_user_id uuid,p_session_generation bigint,p_routine_id uuid,p_version bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $gateway$
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 RETURN public.v2_training_routine_version_candidate(
  p_expected_user_id,p_session_generation,p_routine_id,p_version);
END;
$gateway$;
CREATE FUNCTION public.v2_training_routine_save_owner_candidate(
 p_expected_user_id uuid,p_routine_id uuid,p_expected_version bigint,
 p_action_id uuid,p_name text,p_sport text,p_notes text,p_blocks jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $gateway$
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 RETURN allin_private.v2_training_routine_write_candidate(
  p_expected_user_id,p_routine_id,p_expected_version,p_action_id,
  p_name,p_sport,p_notes,p_blocks);
END;
$gateway$;
CREATE FUNCTION public.v2_training_routine_archive_owner_candidate(
 p_expected_user_id uuid,p_routine_id uuid,p_expected_version bigint,p_action_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $gateway$
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 RETURN allin_private.v2_training_routine_archive_candidate(
  p_expected_user_id,p_routine_id,p_expected_version,p_action_id);
END;
$gateway$;

-- Explicit function ACLs: default PUBLIC EXECUTE is revoked immediately.
REVOKE ALL ON FUNCTION public.v2_training_routine_list_owner_candidate(
 uuid,bigint,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_training_routine_read_owner_candidate(
 uuid,bigint,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_training_routine_save_owner_candidate(
 uuid,uuid,bigint,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_training_routine_archive_owner_candidate(
 uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The sole applicant-facing capabilities. No direct table or private
-- helper grant, no anon grant, no client service_role credential.
GRANT EXECUTE ON FUNCTION public.v2_training_routine_list_owner_candidate(
 uuid,bigint,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_training_routine_read_owner_candidate(
 uuid,bigint,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_training_routine_save_owner_candidate(
 uuid,uuid,bigint,uuid,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_training_routine_archive_owner_candidate(
 uuid,uuid,bigint,uuid) TO authenticated;
COMMIT;
