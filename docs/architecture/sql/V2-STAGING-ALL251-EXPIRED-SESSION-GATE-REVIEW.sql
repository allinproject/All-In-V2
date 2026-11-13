-- ALL-251/222 staging lifecycle compatibility — REVIEW ONLY.
-- Minimal in-place hardening of EXISTING ALL-251 export authorization.
-- This file is not part of the canonical Training domain migration chain.
-- Preserve existing request identity/locks, deletion status, worker RPCs,
-- storage lease fencing, service-only gates and account export limitations.
-- Apply to explicitly approved temporary staging ONLY after refreshed
-- exact function identity, grants and isolated acceptance; never production.
DO $preflight$
DECLARE v_hash text;
BEGIN
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_account_export_requests_candidate') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review') IS NULL
 OR pg_catalog.to_regprocedure('allin_private.v2_deny_deletion_with_open_storage_leases_review()') IS NULL
 THEN RAISE EXCEPTION 'Missing current ALL-251 account-lifecycle/storage gate'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND c.relname='sessions' AND a.attname='not_after'
   AND a.atttypid='timestamptz'::pg_catalog.regtype AND a.attnum>0
   AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION 'Auth sessions not_after contract missing'
 USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) INTO v_hash
 FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure(
  'allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)');
 IF v_hash IS DISTINCT FROM '13ea8437c2e67d458b03d7b0672c7d7f' THEN
  RAISE EXCEPTION 'Concurrent ALL-251 function changed; refresh authoritative definition. Found hash %',v_hash
  USING ERRCODE='40001'; END IF;
 IF pg_catalog.has_function_privilege('anon',
  'allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',
  'allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)','EXECUTE')
 OR pg_catalog.has_function_privilege('service_role',
  'allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Existing private export authorization grants changed'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid='allin_private.v2_account_deletion_requests'::pg_catalog.regclass
 AND t.tgname='v2_privileged_storage_write_fence_review'
 AND NOT t.tgisinternal AND t.tgenabled='O'
 ) THEN RAISE EXCEPTION 'ALL-251 Storage lease deletion fence inactive'
 USING ERRCODE='42501'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION allin_private.v2_account_export_authorize_session_candidate(
 p_user_id uuid,p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $auth$
DECLARE
 v_deletion text;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL THEN
  RAISE EXCEPTION 'Export requires exact account and session' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user_id) THEN
  RAISE EXCEPTION 'Export account no longer exists' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM auth.sessions s
  WHERE s.id=p_session_id AND s.user_id=p_user_id
    AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())
 ) THEN
  RAISE EXCEPTION 'Export session expired, missing or revoked' USING ERRCODE='42501';
 END IF;
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL THEN
  RAISE EXCEPTION 'Owning deletion-state gate not installed' USING ERRCODE='42501';
 END IF;
 SELECT status INTO v_deletion FROM allin_private.v2_account_deletion_requests
 WHERE user_id=p_user_id;
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
REVOKE ALL ON FUNCTION allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- The caller remains the existing private/approved server-only worker;
-- no public owner export endpoint, download or deletion worker is enabled.
