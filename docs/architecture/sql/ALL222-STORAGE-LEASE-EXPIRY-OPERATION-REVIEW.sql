-- ALL-222 / ALL-251 — REVIEW-ONLY candidate for isolated Supabase staging.
-- NOT a migration; DO NOT apply to canonical V2, shared staging or V1.
-- Preserve current service-only attested writer and existing account-deletion locks.
-- Must be paired with real authenticated HTTP standard + signed TUS acceptance.
BEGIN;

-- The existing shared staging inventory was read 2026-11-13: no open leases.
-- If this assertion fails in an isolated replay, fail without making changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review
             WHERE settled_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot retrofit live open Storage leases in this review candidate';
  END IF;
END $$;

ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 minutes');

ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
  ADD CONSTRAINT v2_privileged_storage_lease_expiry_review_check
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes');

-- Ensure an authenticated client can never use the non-attested base issuer.
-- Existing grants on attested wrappers remain service_role-only.
CREATE OR REPLACE FUNCTION public.v2_begin_privileged_storage_write_review(
  p_owner_id uuid, p_bucket_id text, p_object_path text, p_operation text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_status text; v_id uuid;
BEGIN
 IF p_owner_id IS NULL OR p_bucket_id NOT IN (
  'v2-private-workout-objects','v2-private-account-exports')
  OR p_operation NOT IN ('create','replace')
  OR p_object_path IS NULL OR length(p_object_path)>1024
  OR left(p_object_path,length(p_owner_id::text)+1) IS DISTINCT FROM p_owner_id::text||'/'
  OR p_object_path ~ '[[:cntrl:]]'
  OR position('/../' IN '/'||p_object_path||'/')>0
  OR position('/./' IN '/'||p_object_path||'/')>0
 THEN RAISE EXCEPTION 'Invalid privileged Storage write scope' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id)
 OR NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id=p_bucket_id AND public=false)
 THEN RAISE EXCEPTION 'Verified owner and private bucket required'
   USING ERRCODE='42501'; END IF;
 SELECT status INTO v_status FROM allin_private.v2_account_deletion_requests
 WHERE user_id=p_owner_id;
 IF v_status IN ('requested','processing','completed') THEN
  RAISE EXCEPTION 'Deletion request blocks privileged Storage writes'
   USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_privileged_storage_write_leases_review
   (owner_id,bucket_id,object_path,operation,expires_at)
 VALUES(p_owner_id,p_bucket_id,p_object_path,p_operation,
        pg_catalog.clock_timestamp()+interval '30 minutes')
 RETURNING lease_id INTO v_id;
 RETURN v_id;
END $$;

-- This pre-existing metadata fence is kept; we tighten the lease predicate:
-- exact operation, unsigned writer hash prohibited, time bound and unique lease.
CREATE OR REPLACE FUNCTION allin_private.v2_deny_unleased_storage_object_write_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
 v_owner_text text;
 v_owner uuid;
 v_status text;
 v_open_count bigint;
 v_expected_operation text;
BEGIN
 IF TG_OP='UPDATE'
    AND OLD.bucket_id IN ('v2-private-workout-objects','v2-private-account-exports')
    AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name)
 THEN RAISE EXCEPTION 'Moving a private object requires a separately reviewed writer'
   USING ERRCODE='42501'; END IF;

 IF NEW.bucket_id NOT IN ('v2-private-workout-objects','v2-private-account-exports')
 THEN RETURN NEW; END IF;

 IF NEW.name IS NULL OR length(NEW.name)>1024
    OR NEW.name ~ '[[:cntrl:]]'
    OR position('/../' IN '/'||NEW.name||'/')>0
    OR position('/./' IN '/'||NEW.name||'/')>0
 THEN RAISE EXCEPTION 'Private Storage object path is not verified'
   USING ERRCODE='42501'; END IF;

 v_owner_text:=pg_catalog.split_part(NEW.name,'/',1);
 IF v_owner_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR length(NEW.name)<=length(v_owner_text)+1
 THEN RAISE EXCEPTION 'Private Storage owner path is not a verified UUID'
   USING ERRCODE='42501'; END IF;
 v_owner:=v_owner_text::uuid;
 v_expected_operation:=CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'replace' END;

 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||v_owner::text,0));
 SELECT status INTO v_status FROM allin_private.v2_account_deletion_requests
 WHERE user_id=v_owner;
 IF v_status IN ('requested','processing','completed') OR
    NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_owner)
 THEN RAISE EXCEPTION 'Account deletion or absent owner blocks Storage write'
   USING ERRCODE='42501'; END IF;

 SELECT pg_catalog.count(*) INTO v_open_count
 FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=v_owner AND bucket_id=NEW.bucket_id
   AND object_path=NEW.name
   AND operation=v_expected_operation
   AND writer_sha256_review IS NOT NULL
   AND settled_at IS NULL AND expires_at > pg_catalog.clock_timestamp();

 IF v_open_count<>1 THEN
   RAISE EXCEPTION 'Exactly one unexpired attested operation-matched Storage write lease required'
     USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;

-- Pre-existing trigger v2_privileged_storage_metadata_write_fence_review remains
-- installed on storage.objects INSERT and selected UPDATE columns. Its function
-- now checks actual operation, attestation binding and expiration.
-- WARNING: provider TUS may perform UPDATE metadata after CREATE. Prove the
-- provider's real sequence before promotion; do not weaken this fence to pass.
-- At signed URL expiry (provider documented 2h), capability may outlive this
-- 30m lease; clients must reauthorize, and no assumed revocation of TUS URLs.
-- When testing, assert there are no client grants to base/attested issuers,
-- no public/private bucket exposure, no untracked object bytes and no open leases.
COMMIT;
