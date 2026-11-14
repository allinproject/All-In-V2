-- ALL-251 WORKER REVIEW-ONLY. Not an applied migration.
-- Reuse the existing canonical session/export authorization check;
-- do NOT create a second session or deletion state source of truth.
-- Dependency: allin_private.v2_account_export_authorize_session_candidate
-- already deployed, verified and independently reviewed for the target.
-- This thin gateway makes no Storage decision and grants no write lease.
--
-- SECURITY REVIEW REQUIRED BEFORE HOSTED INSTALLATION:
-- confirm the canonical candidate's auth.sessions + deletion state gate,
-- explicit PUBLIC/anon/authenticated/service_role grants, and auth.uid()
-- ownership under JWT-backed PostgREST; test two real accounts and revoked
-- sessions. Review whether exportPermitted is the intended policy for
-- private workout bytes; account-level session status alone is not upload
-- authorization. This function exposes only a boolean, not account data.
CREATE FUNCTION public.v2_all251_worker_session_check_review()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=''
AS $body$
DECLARE
 v_owner uuid;
 v_session uuid;
 v_decision jsonb;
BEGIN
 v_owner := auth.uid();
 IF v_owner IS NULL THEN
   RAISE EXCEPTION 'Session not active' USING ERRCODE='42501';
 END IF;
 -- The client must not provide user IDs or session IDs as RPC arguments.
 -- PostgREST verifies the JWT before supplying these server-side claims.
 IF (auth.jwt()->>'session_id') IS NULL OR
    (auth.jwt()->>'session_id') !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN
   RAISE EXCEPTION 'Session not active' USING ERRCODE='42501';
 END IF;
 v_session := (auth.jwt()->>'session_id')::uuid;
 v_decision :=
   allin_private.v2_account_export_authorize_session_candidate(
     v_owner,v_session
   );
 IF v_decision->>'activeSession' IS DISTINCT FROM 'true' OR
    v_decision->>'exportPermitted' IS DISTINCT FROM 'true' OR
    v_decision->>'ownerId' IS DISTINCT FROM v_owner::text
 THEN
   RAISE EXCEPTION 'Session not active' USING ERRCODE='42501';
 END IF;
 RETURN true;
END
$body$;
REVOKE ALL ON FUNCTION public.v2_all251_worker_session_check_review()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_all251_worker_session_check_review()
 TO authenticated;
-- After review and ONLY staged activation: run verified JWT-backed RPC
-- with A's active session, B's session, revoked A session, a deleted/
-- pending account and a service-role-only call; no privilege fallback.
-- This review file must never be executed implicitly by CI.
