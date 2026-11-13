-- ALL-251 REVIEW ONLY. Not a migration, Storage policy or deployed RPC.
-- Reuses canonical allin_private.v2_account_deletion_requests and same
-- advisory-lock key as v2_request_account_deletion / cancellation.
-- A future upload writer must hold the SAME transaction to commit while
-- this function's lock is held; doing a standalone preflight is insufficient.
-- All service-role/Admin uploads bypassing Storage RLS require their own
-- authoritative writer-path check; this function alone is NOT a write freeze.
CREATE FUNCTION allin_private.v2_assert_owner_storage_write_allowed_review(
 p_owner_id uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_status text;
BEGIN
 IF p_owner_id IS NULL OR auth.uid() IS NULL
    OR auth.uid() IS DISTINCT FROM p_owner_id THEN
   RAISE EXCEPTION 'Verified active owner required for Storage upload'
    USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_owner_id) THEN
   RAISE EXCEPTION 'Storage writer owner no longer exists'
    USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 SELECT r.status INTO v_status
 FROM allin_private.v2_account_deletion_requests r
 WHERE r.user_id=p_owner_id;
 -- Requested and processing immediately block uploads. Completed also
 -- blocks, though the Auth row should already be absent. Cancellation and
 -- rejection are no longer active; owner may resume normal uploads.
 IF v_status IN ('requested','processing','completed') THEN
   RAISE EXCEPTION 'Account deletion request blocks Storage uploads'
    USING ERRCODE='42501';
 END IF;
 RETURN TRUE;
END $fn$;
REVOKE ALL ON FUNCTION allin_private.v2_assert_owner_storage_write_allowed_review(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- No EXECUTE grant intentionally: reviewed future Storage policy must
-- explicitly authorize authenticated-only invocation, and must not
-- let this function become a public owner-existence/status oracle.
