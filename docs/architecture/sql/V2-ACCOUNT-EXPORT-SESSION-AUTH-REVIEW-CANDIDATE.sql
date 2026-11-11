-- ALL-251 REVIEW ONLY — session-bound authorization for EXISTING V2
-- account-export workflow. NOT A MIGRATION OR DEPLOYABLE RELEASE.
--
-- An authenticated owner invokes the existing public account-export entrypoint;
-- the eventual trusted worker separately requires this gate to validate the
-- same Auth user, current session and deletion state before ANY Storage read.
-- Never expose this function to anon/authenticated or arbitrary client RPC.
-- The server must obtain p_session_id from a validated bearer token, never
-- client JSON. This is a private, service-role-only authorization probe.
CREATE FUNCTION allin_private.v2_account_export_authorize_session_candidate(
  p_user_id uuid, p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $auth$
DECLARE
  v_deletion text;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL THEN
   RAISE EXCEPTION 'Export requires exact account and session' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM auth.users u WHERE u.id=p_user_id
 ) THEN
   RAISE EXCEPTION 'Export account no longer exists' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM auth.sessions s
   WHERE s.id=p_session_id AND s.user_id=p_user_id
 ) THEN
   RAISE EXCEPTION 'Export session missing or revoked' USING ERRCODE='42501';
 END IF;
 SELECT status INTO v_deletion
 FROM allin_private.v2_account_deletion_requests
 WHERE user_id=p_user_id;
 -- A pending deletion request should not permit a new private archive until
 -- explicitly cancelled. The export and deletion features must reconcile
 -- their legal requirements in ALL-251 before enabling this gate.
 IF v_deletion IS NOT NULL AND v_deletion<>'cancelled' THEN
   RAISE EXCEPTION 'Deletion state blocks private export' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object(
   'ownerId',p_user_id,'sessionId',p_session_id,
   'activeSession',true,'exportPermitted',true,
   'completeUserExport',false
 );
END;
$auth$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit service_role grant MUST be reviewed in the owning ALL-251
-- migration with full provider identity and server-call acceptance.
