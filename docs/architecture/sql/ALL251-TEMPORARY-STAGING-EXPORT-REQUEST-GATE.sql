-- ALL-251 ISOLATED TEMPORARY STAGING ONLY. Reuse the canonical review candidates.
-- This standalone staging fixture DOES NOT approve production release.
-- Fail closed while the owning deletion-state table is not installed.
CREATE SCHEMA IF NOT EXISTS allin_private;
REVOKE ALL ON SCHEMA allin_private FROM PUBLIC,anon,authenticated;

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
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL THEN
  RAISE EXCEPTION 'Owning deletion-state gate not installed' USING ERRCODE='42501';
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


-- ALL-251 REVIEW ONLY — durable requests owned by EXISTING account export.
-- NOT A MIGRATION. No client writer, no worker scheduling, no grants.
-- The existing account-export Profile flow remains the sole initiation UX.
-- This model stores an explicit server-reviewed export job identity so a valid
-- login alone cannot open arbitrary historical private workout files.
CREATE TABLE allin_private.v2_account_export_requests_candidate (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'requested'
   CHECK(status IN ('requested','approved','staging','staged','expired','cancelled','failed')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>requested_at AND expires_at<=requested_at+interval '24 hours')
);
CREATE INDEX v2_export_req_owner_status ON allin_private.v2_account_export_requests_candidate(user_id,status);
ALTER TABLE allin_private.v2_account_export_requests_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_export_requests_candidate FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_account_export_authorize_request_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $auth$
DECLARE
 v_session jsonb;
 v_request allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 v_session:=allin_private.v2_account_export_authorize_session_candidate(p_user_id,p_session_id);
 IF v_session->>'activeSession'<>'true'
 THEN RAISE EXCEPTION 'Current Auth session is not eligible' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_request FROM allin_private.v2_account_export_requests_candidate
 WHERE request_id=p_request_id AND user_id=p_user_id
   AND session_id=p_session_id;
 IF NOT FOUND OR v_request.status NOT IN ('approved','staging','staged')
   OR v_request.expires_at<=pg_catalog.now()
 THEN RAISE EXCEPTION 'Export request is not approved or has expired' USING ERRCODE='42501'; END IF;
 RETURN pg_catalog.jsonb_build_object('requestId',p_request_id,
  'ownerId',p_user_id,'sessionId',p_session_id,
  'status','approved','cancelled',false,'expiresAt',v_request.expires_at);
END;
$auth$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_authorize_request_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- No client request creation or service grant until canonical ALL-251
-- export worker, migration/rollback and personal-data coverage are approved.


-- ALL-251 REVIEW ONLY — owner-initiated request lifecycle for the EXISTING
-- Profile account-export feature. NOT A MIGRATION. All RPC grants OFF.
-- Do not enable until legal/export/Storage and user-device acceptance.
CREATE FUNCTION public.v2_begin_account_export_candidate(
 p_expected_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $begin$
DECLARE
 v_owner uuid:=auth.uid();
 v_session_claim text:=auth.jwt()->>'session_id';
 v_session uuid;
 v_existing allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 IF v_owner IS NULL OR p_expected_user_id IS DISTINCT FROM v_owner
    OR v_session_claim IS NULL
    OR v_session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Active export owner and session required' USING ERRCODE='42501'; END IF;
 v_session:=v_session_claim::uuid;
 -- Serialize with the EXISTING ALL-251 deletion request owner lock.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||v_owner::text,0));
 PERFORM allin_private.v2_account_export_authorize_session_candidate(v_owner,v_session);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-export-request:'||v_owner::text,0));
 SELECT * INTO v_existing
 FROM allin_private.v2_account_export_requests_candidate
 WHERE user_id=v_owner AND status IN ('requested','approved','staging','staged')
   AND expires_at>pg_catalog.now()
 ORDER BY requested_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO allin_private.v2_account_export_requests_candidate(
   request_id,user_id,session_id,status,expires_at)
  VALUES(pg_catalog.gen_random_uuid(),v_owner,v_session,'requested',
   pg_catalog.now()+interval '1 hour')
  RETURNING * INTO v_existing;
 ELSIF v_existing.session_id<>v_session THEN
  RAISE EXCEPTION 'Existing export request belongs to another session'
   USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',v_owner,
   'requestId',v_existing.request_id,'status',v_existing.status,
   'expiresAt',v_existing.expires_at,'completeUserExport',false);
END;
$begin$;
REVOKE ALL ON FUNCTION public.v2_begin_account_export_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_account_export_approve_request_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $approve$
DECLARE
 v_request allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 -- Lock in the same order as owner initiation to prevent concurrent
 -- account-deletion requests from racing into an export approval.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_user_id::text,0));
 PERFORM allin_private.v2_account_export_authorize_session_candidate(
  p_user_id,p_session_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-export-request:'||p_user_id::text,0));
 SELECT * INTO v_request
 FROM allin_private.v2_account_export_requests_candidate
 WHERE user_id=p_user_id AND session_id=p_session_id
   AND request_id=p_request_id
 FOR UPDATE;
 IF NOT FOUND OR v_request.status NOT IN ('requested','approved')
    OR v_request.expires_at<=pg_catalog.now()
 THEN RAISE EXCEPTION 'Export request cannot be approved' USING ERRCODE='42501'; END IF;
 IF v_request.status='requested' THEN
  UPDATE allin_private.v2_account_export_requests_candidate
  SET status='approved',updated_at=pg_catalog.now()
  WHERE request_id=p_request_id AND status='requested'
  RETURNING * INTO v_request;
 END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',v_request.user_id,
  'sessionId',v_request.session_id,'requestId',v_request.request_id,
  'status',v_request.status,'expiresAt',v_request.expires_at);
END;
$approve$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_approve_request_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Service-only PostgREST bridge. No private schema exposure or client grants.
CREATE FUNCTION public.v2_account_export_worker_approve_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $worker$
BEGIN
 RETURN allin_private.v2_account_export_approve_request_candidate(
   p_user_id,p_session_id,p_request_id);
END;
$worker$;
REVOKE ALL ON FUNCTION
 public.v2_account_export_worker_approve_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit owner-reviewed authenticated begin and service-role approve grants
-- must be separate approved migration steps. Everything stays OFF now.


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

-- Only trusted server-side bridge RPCs; owner-initiated public RPC remains OFF.
GRANT EXECUTE ON FUNCTION public.v2_account_export_worker_authorize_candidate(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_account_export_worker_approve_candidate(uuid,uuid,uuid) TO service_role;
