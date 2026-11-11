-- ALL-251 REVIEW ONLY: service-only Data API bridge to the private,
-- session- and request-bound existing account-export authorization.
-- NOT A MIGRATION; remains uncallable by all API roles until owner signoff.
-- The private schema must NEVER be exposed to PostgREST merely for this.
CREATE FUNCTION public.v2_account_export_worker_authorize_candidate(
  p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $worker$
BEGIN
  -- Service-role caller permission is granted explicitly only after release.
  -- Auth user/session, deletion status, exact approved request and TTL are
  -- all checked by the owning allin_private implementations.
  RETURN allin_private.v2_account_export_authorize_request_candidate(
    p_user_id,p_session_id,p_request_id
  );
END;
$worker$;
REVOKE ALL ON FUNCTION
 public.v2_account_export_worker_authorize_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Owner-approved release ONLY:
-- GRANT EXECUTE ON FUNCTION
-- public.v2_account_export_worker_authorize_candidate(uuid,uuid,uuid)
-- TO service_role;
-- Never grant to anon/authenticated. Do not enable by default.
