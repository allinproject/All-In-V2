-- ALL-251 DISPOSABLE STAGING REVIEW: authenticated caller HMAC lease facade.
-- Reuses the existing canonical attested begin and settle SECURITY DEFINER
-- implementations, signer/nonce ledger and DB deletion lock. No new writer.
-- Only usable with a real user JWT whose auth.uid() matches the HMAC owner.
-- No Supabase service_role / sb_secret key is required in the Worker.
-- NEVER copy this staging-only function into production without separate
-- Auth, security advisor, restore, lease-race and session-revocation reviews.

CREATE FUNCTION public.v2_all251_owner_attested_begin_review(
 p_owner_id uuid,p_bucket_id text,p_object_path text,p_operation text,
 p_sha256 text,p_nonce uuid,p_issued_epoch bigint,p_signature text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $begin$
DECLARE v_session uuid; v_decision jsonb;
BEGIN
 IF p_owner_id IS NULL OR auth.uid() IS DISTINCT FROM p_owner_id
    OR auth.jwt()->>'session_id' IS NULL
    OR auth.jwt()->>'session_id' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN
  RAISE EXCEPTION 'Verified owner session required' USING ERRCODE='42501';
 END IF;
 v_session := (auth.jwt()->>'session_id')::uuid;
 v_decision:=allin_private.v2_account_export_authorize_session_candidate(
  p_owner_id,v_session);
 IF v_decision->>'activeSession' IS DISTINCT FROM 'true' OR
    v_decision->>'exportPermitted' IS DISTINCT FROM 'true' OR
    v_decision->>'ownerId' IS DISTINCT FROM p_owner_id::text
 THEN
  RAISE EXCEPTION 'Active owner required' USING ERRCODE='42501';
 END IF;
 -- Existing attested begin rechecks the deletion freeze under the SAME
 -- owning advisory lock, preventing a preflight / freeze race.
 RETURN public.v2_begin_privileged_storage_write_attested_review(
  p_owner_id,p_bucket_id,p_object_path,p_operation,
  p_sha256,p_nonce,p_issued_epoch,p_signature);
END $begin$;
REVOKE ALL ON FUNCTION public.v2_all251_owner_attested_begin_review(
 uuid,text,text,text,text,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_all251_owner_attested_begin_review(
 uuid,text,text,text,text,uuid,bigint,text) TO authenticated;

CREATE FUNCTION public.v2_all251_owner_attested_settle_review(
 p_owner_id uuid,p_lease_id uuid,p_nonce uuid,p_issued_epoch bigint,
 p_signature text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $settle$
DECLARE v_session uuid;
BEGIN
 IF p_owner_id IS NULL OR auth.uid() IS DISTINCT FROM p_owner_id
    OR auth.jwt()->>'session_id' IS NULL
    OR auth.jwt()->>'session_id' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN
  RAISE EXCEPTION 'Verified lease owner session required'
   USING ERRCODE='42501';
 END IF;
 v_session := (auth.jwt()->>'session_id')::uuid;
 -- IMPORTANT: a deletion request may arrive after lease begin. Settle
 -- must remain possible for that in-flight lease while the session is
 -- active. Do NOT reject solely because deletion status is requested.
 IF NOT EXISTS(
  SELECT 1 FROM auth.sessions s
  WHERE s.id=v_session AND s.user_id=p_owner_id
    AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())
 ) OR NOT EXISTS(
  SELECT 1 FROM auth.users u WHERE u.id=p_owner_id
 ) THEN
  RAISE EXCEPTION 'Lease owner session is no longer active'
   USING ERRCODE='42501';
 END IF;
 -- Existing attested settle checks lease ownership and immutable payload
 -- digest, exact HMAC, fresh nonce and settlement uniqueness.
 RETURN public.v2_settle_privileged_storage_write_attested_review(
  p_owner_id,p_lease_id,p_nonce,p_issued_epoch,p_signature);
END $settle$;
REVOKE ALL ON FUNCTION public.v2_all251_owner_attested_settle_review(
 uuid,uuid,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_all251_owner_attested_settle_review(
 uuid,uuid,uuid,bigint,text) TO authenticated;
