-- ALL-222 / ALL-251 — ISOLATED REVIEW CANDIDATE ONLY.
-- NOT APPLIED to staging, canonical V2 or V1; NOT a deployable release migration.
-- Requires separate provider TUS-session revocation / completion-denial evidence.
-- Do not apply this SQL until complete isolated replay and security approval.
BEGIN;

ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
  ADD COLUMN cancelled_at timestamptz;

ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
  ADD CONSTRAINT v2_privileged_storage_lease_one_terminal_review
  CHECK (settled_at IS NULL OR cancelled_at IS NULL);

-- Do not permit a cancellation to masquerade as successful settlement.
-- Keep historical settled leases intact. Existing lease rows are not changed.
CREATE OR REPLACE FUNCTION allin_private.v2_verify_storage_writer_attestation_review(
 p_action text,p_owner uuid,p_bucket text,p_path text,p_operation text,
 p_hash text,p_lease uuid,p_nonce uuid,p_epoch bigint,p_hmac text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_key bytea; v_message text; v_expected text;
BEGIN
 IF p_action NOT IN ('begin','settle','cancel') OR p_owner IS NULL OR
    p_nonce IS NULL OR p_epoch IS NULL OR
    (p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$') OR
    (p_hmac IS NULL OR p_hmac !~ '^[0-9a-f]{64}$') OR
    p_path IS NULL OR p_path LIKE '%|%' OR p_path ~ '[[:cntrl:]]' OR
    p_bucket IS NULL OR p_bucket LIKE '%|%' OR
    p_operation NOT IN ('create','replace') OR
    pg_catalog.abs(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())::bigint-p_epoch)>120 OR
    (p_action='begin' AND p_lease IS NOT NULL) OR
    (p_action IN ('settle','cancel') AND p_lease IS NULL)
 THEN RAISE EXCEPTION 'Writer attestation rejected' USING ERRCODE='42501'; END IF;
 SELECT secret INTO v_key
 FROM allin_private.v2_privileged_storage_writer_key_review
 WHERE singleton=true;
 IF v_key IS NULL THEN
  RAISE EXCEPTION 'Writer signing key not provisioned' USING ERRCODE='42501'; END IF;
 v_message:=pg_catalog.concat_ws('|',
  'v2-writer-v1',p_action,p_owner::text,p_bucket,p_path,
  p_operation,p_hash,coalesce(p_lease::text,''),p_nonce::text,p_epoch::text);
 v_expected:=pg_catalog.encode(extensions.hmac(
  pg_catalog.convert_to(v_message,'UTF8'),v_key,'sha256'),'hex');
 IF v_expected IS DISTINCT FROM p_hmac THEN
  RAISE EXCEPTION 'Writer signature rejected' USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_privileged_storage_writer_nonces_review
  (nonce,action,owner_id) VALUES(p_nonce,p_action,p_owner);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Writer nonce replay rejected' USING ERRCODE='42501';
END $$;

-- Exact attested cancellation; state transition lives in the existing lease table.
-- Service-role ONLY. This intentionally does NOT claim provider TUS URL revocation.
CREATE OR REPLACE FUNCTION public.v2_cancel_privileged_storage_write_attested_review(
 p_owner_id uuid,p_lease_id uuid,p_bucket_id text,p_object_path text,
 p_operation text,p_sha256 text,p_nonce uuid,p_issued_epoch bigint,p_signature text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_lease record;
BEGIN
 IF p_owner_id IS NULL OR p_lease_id IS NULL THEN
  RAISE EXCEPTION 'Exact owner and lease required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 SELECT bucket_id,object_path,operation,writer_sha256_review,settled_at,cancelled_at
 INTO v_lease
 FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=p_owner_id AND lease_id=p_lease_id FOR UPDATE;
 IF NOT FOUND OR v_lease.settled_at IS NOT NULL OR
    v_lease.cancelled_at IS NOT NULL OR
    v_lease.writer_sha256_review IS NULL OR
    v_lease.bucket_id IS DISTINCT FROM p_bucket_id OR
    v_lease.object_path IS DISTINCT FROM p_object_path OR
    v_lease.operation IS DISTINCT FROM p_operation OR
    v_lease.writer_sha256_review IS DISTINCT FROM p_sha256
 THEN RAISE EXCEPTION 'Exact unresolved attested lease required'
  USING ERRCODE='42501'; END IF;
 -- A completed object is NOT an abandoned upload. This check is serialized
 -- with the private Storage metadata fence through the same owner advisory lock.
 IF EXISTS (
   SELECT 1 FROM storage.objects
   WHERE bucket_id=p_bucket_id AND name=p_object_path
 ) THEN RAISE EXCEPTION 'Completed Storage object cannot be cancelled'
   USING ERRCODE='42501'; END IF;
 PERFORM allin_private.v2_verify_storage_writer_attestation_review(
  'cancel',p_owner_id,p_bucket_id,p_object_path,p_operation,
  p_sha256,p_lease_id,p_nonce,p_issued_epoch,p_signature);
 UPDATE allin_private.v2_privileged_storage_write_leases_review
 SET cancelled_at=now()
 WHERE owner_id=p_owner_id AND lease_id=p_lease_id
  AND settled_at IS NULL AND cancelled_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease cancellation race'
  USING ERRCODE='42501'; END IF;
 RETURN true;
END $$;

-- Also guard the legacy base settlement RPC, even if a trusted service
-- invokes it directly. This prevents either settlement path from accepting
-- a cancelled lease. Keep its existing scope, return and locking behavior.
CREATE OR REPLACE FUNCTION public.v2_settle_privileged_storage_write_review(
 p_owner_id uuid,p_lease_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $all222base$
DECLARE v_count integer;
BEGIN
 IF p_owner_id IS NULL OR p_lease_id IS NULL THEN
  RAISE EXCEPTION 'Exact privileged Storage lease scope required'
   USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 UPDATE allin_private.v2_privileged_storage_write_leases_review
 SET settled_at=now()
 WHERE owner_id=p_owner_id AND lease_id=p_lease_id
   AND settled_at IS NULL AND cancelled_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN
  RAISE EXCEPTION 'Unknown, cancelled or already settled Storage lease'
   USING ERRCODE='42501'; END IF;
 RETURN true;
END $all222base$;

-- An existing settled lease cannot be cancelled; a cancelled one cannot
-- be settled. Preserve the original authorized signed settlement mechanism.
CREATE OR REPLACE FUNCTION public.v2_settle_privileged_storage_write_attested_review(
 p_owner_id uuid,p_lease_id uuid,p_nonce uuid,p_issued_epoch bigint,p_signature text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_lease record;
BEGIN
 IF p_owner_id IS NULL OR p_lease_id IS NULL THEN
  RAISE EXCEPTION 'Exact owner and lease required' USING ERRCODE='42501'; END IF;
 -- Match begin/cancel/base-settle: advisory owner lock FIRST, row lock SECOND.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 SELECT bucket_id,object_path,operation,writer_sha256_review,settled_at,cancelled_at
 INTO v_lease FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=p_owner_id AND lease_id=p_lease_id FOR UPDATE;
 IF NOT FOUND OR v_lease.settled_at IS NOT NULL OR
    v_lease.cancelled_at IS NOT NULL OR
    v_lease.writer_sha256_review IS NULL
 THEN RAISE EXCEPTION 'Attested unresolved noncancelled lease required'
  USING ERRCODE='42501'; END IF;
 PERFORM allin_private.v2_verify_storage_writer_attestation_review(
  'settle',p_owner_id,v_lease.bucket_id,v_lease.object_path,
  v_lease.operation,v_lease.writer_sha256_review,p_lease_id,
  p_nonce,p_issued_epoch,p_signature);
 RETURN public.v2_settle_privileged_storage_write_review(p_owner_id,p_lease_id);
END $$;

-- Fence UPDATE writer rows after cancellation. This cannot be bypassed by
-- a service_role operation that successfully authenticates but has no open lease.
-- Existing operation/expiry predicate is preserved in this review function.
CREATE OR REPLACE FUNCTION allin_private.v2_deny_unleased_storage_object_write_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
 v_owner_text text; v_owner uuid; v_status text;
 v_open_count bigint; v_expected_operation text;
BEGIN
 IF TG_OP='UPDATE'
    AND OLD.bucket_id IN ('v2-private-workout-objects','v2-private-account-exports')
    AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name)
 THEN RAISE EXCEPTION 'Moving a private object requires separately reviewed writer'
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
   AND object_path=NEW.name AND operation=v_expected_operation
   AND writer_sha256_review IS NOT NULL
   AND settled_at IS NULL AND cancelled_at IS NULL
   AND expires_at > pg_catalog.clock_timestamp();
 IF v_open_count<>1 THEN
  RAISE EXCEPTION 'Exactly one unexpired active attested Storage lease required'
   USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;

-- IMPORTANT: never unlock deletion based on cancelled_at alone until provider
-- session invalidation / late completion is proven. Therefore DO NOT modify
-- the existing deletion / Auth deletion fences here: they still block any
-- settled_at IS NULL lease, including cancelled ones. A later separately
-- reviewed deletion-gate change must be conditioned on full provider proof.

REVOKE ALL ON FUNCTION public.v2_cancel_privileged_storage_write_attested_review(
 uuid,uuid,text,text,text,text,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_cancel_privileged_storage_write_attested_review(
 uuid,uuid,text,text,text,text,uuid,bigint,text) TO service_role;
-- Reassert the attested cutover ACL on both settlement entry points.
REVOKE ALL ON FUNCTION public.v2_settle_privileged_storage_write_review(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_settle_privileged_storage_write_attested_review(
 uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_settle_privileged_storage_write_attested_review(
 uuid,uuid,uuid,bigint,text) TO service_role;
COMMIT;
