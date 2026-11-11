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
