-- ALL-251 ISOLATED REVIEW ONLY — cryptographically attested canonical lease entry.
-- Requires V2-ACCOUNT-DELETION-PRIVILEGED-STORAGE-WRITER-REVIEW.sql
-- and pgcrypto in schema extensions. NOT an applied migration or permission
-- to activate account deletion. No signing secret is included in source.
--
-- A project-wide service-role key is NOT itself writer authorization.
-- The existing begin/settle RPC grants are REVOKED in this candidate, and
-- new RPCs require a bounded owner/path/body-digest HMAC signed by a separately
-- controlled canonical writer. This DOES NOT prove that all provider-level
-- REST/S3/signed/TUS/multipart completion routes honor metadata triggers.
DO $preflight$
BEGIN
 IF pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
 OR pg_catalog.to_regprocedure('public.v2_begin_privileged_storage_write_review(uuid,text,text,text)') IS NULL
 OR pg_catalog.to_regprocedure('public.v2_settle_privileged_storage_write_review(uuid,uuid)') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL
 THEN RAISE EXCEPTION 'Canonical lease RPCs and pgcrypto verifier must exist before attestation review'
   USING ERRCODE='42501'; END IF;
END $preflight$;
CREATE TABLE allin_private.v2_privileged_storage_writer_attestation_keys_review (
 key_version integer PRIMARY KEY CHECK (key_version BETWEEN 1 AND 1000),
 secret bytea NOT NULL CHECK (pg_catalog.octet_length(secret)=32),
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE allin_private.v2_privileged_storage_writer_attestation_keys_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_privileged_storage_writer_attestation_keys_review
 FROM PUBLIC,anon,authenticated,service_role;
-- A trusted operator must separately provision the key in the private schema,
-- distribute it ONLY to the existing canonical writer and record key custody.
-- Without a key, begin/settle both DENY. Never return the secret through RPC.

ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
 ADD COLUMN attested_nonce uuid,
 ADD COLUMN attested_sha256 text,
 ADD COLUMN attested_key_version integer;
CREATE UNIQUE INDEX v2_priv_storage_attested_nonce_review
 ON allin_private.v2_privileged_storage_write_leases_review(attested_nonce)
 WHERE attested_nonce IS NOT NULL;
ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
 ADD CONSTRAINT v2_attested_digest_review
 CHECK (attested_sha256 IS NULL OR attested_sha256 ~ '^[0-9a-f]{64}$');

-- The old un-attested entry points MUST become unreachable by service_role.
-- Existing open legacy leases stay open until separately reconciled; no TTL.
REVOKE EXECUTE ON FUNCTION public.v2_begin_privileged_storage_write_review(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.v2_settle_privileged_storage_write_review(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.v2_begin_attested_privileged_storage_write_review(
 p_owner uuid,p_bucket text,p_path text,p_operation text,
 p_sha256 text,p_nonce uuid,p_expires_epoch bigint,
 p_key_version integer,p_mac text
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $begin$
DECLARE v_now bigint;v_secret bytea;v_expected text;v_status text;v_id uuid;
BEGIN
 v_now:=EXTRACT(epoch FROM pg_catalog.clock_timestamp())::bigint;
 IF p_owner IS NULL OR p_nonce IS NULL
 OR p_bucket NOT IN ('v2-private-workout-objects','v2-private-account-exports')
 OR p_operation NOT IN ('create','replace')
 OR p_path IS NULL OR pg_catalog.length(p_path)>1024
 OR p_path !~ '^[A-Za-z0-9._/-]+$'
 OR pg_catalog.left(p_path,pg_catalog.length(p_owner::text)+1) IS DISTINCT FROM p_owner::text||'/'
 OR p_path ~ '(^|/)\.\.?(/|$)'
 OR p_sha256 !~ '^[0-9a-f]{64}$'
 OR p_mac !~ '^[0-9a-f]{64}$'
 OR p_key_version IS NULL
 OR p_expires_epoch IS NULL OR p_expires_epoch<=v_now OR p_expires_epoch>v_now+90
 THEN RAISE EXCEPTION 'Unapproved attested Storage upload scope' USING ERRCODE='42501'; END IF;
 SELECT secret INTO v_secret
 FROM allin_private.v2_privileged_storage_writer_attestation_keys_review
 WHERE key_version=p_key_version AND enabled=true;
 IF v_secret IS NULL THEN
  RAISE EXCEPTION 'Attested writer verification key not provisioned' USING ERRCODE='42501';
 END IF;
 v_expected:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(
  pg_catalog.concat_ws(E'\n','all251-begin-v1',p_owner::text,p_bucket,p_path,
    p_operation,p_sha256,p_nonce::text,p_expires_epoch::text,p_key_version::text),'UTF8'),
  v_secret,'sha256'),'hex');
 IF v_expected IS DISTINCT FROM p_mac THEN
  RAISE EXCEPTION 'Privileged writer attestation invalid' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner)
 OR NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id=p_bucket AND public=false)
 THEN RAISE EXCEPTION 'Verified owner and private Storage bucket required' USING ERRCODE='42501'; END IF;
 SELECT status INTO v_status FROM allin_private.v2_account_deletion_requests
 WHERE user_id=p_owner;
 IF v_status IN ('requested','processing','completed') THEN
  RAISE EXCEPTION 'Pending account deletion freezes Storage writes' USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_privileged_storage_write_leases_review
  (owner_id,bucket_id,object_path,operation,attested_nonce,attested_sha256,attested_key_version)
 VALUES (p_owner,p_bucket,p_path,p_operation,p_nonce,p_sha256,p_key_version)
 RETURNING lease_id INTO v_id;
 RETURN v_id;
END $begin$;
REVOKE ALL ON FUNCTION public.v2_begin_attested_privileged_storage_write_review(
 uuid,text,text,text,text,uuid,bigint,integer,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_begin_attested_privileged_storage_write_review(
 uuid,text,text,text,text,uuid,bigint,integer,text) TO service_role;

CREATE FUNCTION public.v2_settle_attested_privileged_storage_write_review(
 p_owner uuid,p_lease uuid,p_sha256 text,p_expires_epoch bigint,p_mac text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $settle$
DECLARE v_lease record;v_now bigint;v_secret bytea;v_expected text;
BEGIN
 v_now:=EXTRACT(epoch FROM pg_catalog.clock_timestamp())::bigint;
 IF p_owner IS NULL OR p_lease IS NULL
 OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_mac !~ '^[0-9a-f]{64}$'
 OR p_expires_epoch IS NULL OR p_expires_epoch<=v_now OR p_expires_epoch>v_now+90
 THEN RAISE EXCEPTION 'Exact settled Storage attestation required' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner::text,0));
 SELECT attested_nonce,attested_sha256,attested_key_version,settled_at
 INTO v_lease FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=p_owner AND lease_id=p_lease FOR UPDATE;
 IF NOT FOUND OR v_lease.settled_at IS NOT NULL
 OR v_lease.attested_nonce IS NULL
 OR v_lease.attested_sha256 IS DISTINCT FROM p_sha256
 THEN RAISE EXCEPTION 'Unsettled matching attested lease required' USING ERRCODE='42501'; END IF;
 SELECT secret INTO v_secret
 FROM allin_private.v2_privileged_storage_writer_attestation_keys_review
 WHERE key_version=v_lease.attested_key_version AND enabled=true;
 IF v_secret IS NULL THEN
  RAISE EXCEPTION 'Attested settlement key unavailable' USING ERRCODE='42501'; END IF;
 v_expected:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(
  pg_catalog.concat_ws(E'\n','all251-settle-v1',p_owner::text,p_lease::text,
    v_lease.attested_nonce::text,p_sha256,p_expires_epoch::text,
    v_lease.attested_key_version::text),'UTF8'),v_secret,'sha256'),'hex');
 IF v_expected IS DISTINCT FROM p_mac THEN
  RAISE EXCEPTION 'Storage settlement attestation invalid' USING ERRCODE='42501'; END IF;
 -- Only the already-attested canonical writer may now settle after actual
 -- provider byte SHA-256 readback. Ambiguous HTTP writes stay open forever
 -- until independent authorized reconciliation.
 UPDATE allin_private.v2_privileged_storage_write_leases_review
 SET settled_at=pg_catalog.clock_timestamp()
 WHERE owner_id=p_owner AND lease_id=p_lease AND settled_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Duplicate Storage settlement denied'
   USING ERRCODE='42501'; END IF;
 RETURN true;
END $settle$;
REVOKE ALL ON FUNCTION public.v2_settle_attested_privileged_storage_write_review(
 uuid,uuid,text,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_settle_attested_privileged_storage_write_review(
 uuid,uuid,text,bigint,text) TO service_role;

-- Signed leases are still NOT provider-level exclusivity: an unrestricted
-- Supabase project credential, S3 signing pair or delayed TUS write may
-- bypass DB metadata hooks. No readiness TRUE or worker enablement here.
