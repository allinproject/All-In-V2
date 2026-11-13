-- ALL-251: REVIEW-ONLY optional $0 writer attestation layer.
-- NOT A MIGRATION. DO NOT APPLY IN HOSTED OR PRODUCTION WITHOUT SEPARATE
-- APPROVAL, ROLLBACK/RESTORE EVIDENCE, SIGNER PROVISIONING AND NEGATIVE TESTS.
-- Depends on existing canonical storage lease table and begin/settle RPCs.
-- This is defense in depth, NOT provider-enforced Storage byte isolation.
--
-- A *separate* 32-byte random HMAC secret is provisioned by a privileged
-- operator directly into this private table and into ONLY the canonical
-- writer's server-side secret store. NEVER store it in Git or issue it to
-- general service-role clients, test runner logs, or mobile applications.
CREATE TABLE allin_private.v2_privileged_storage_writer_key_review (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 secret bytea NOT NULL CHECK(octet_length(secret)=32),
 provisioned_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE allin_private.v2_privileged_storage_writer_key_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_privileged_storage_writer_key_review
 FROM PUBLIC,anon,authenticated,service_role;

-- Replay receipts remain durable. Never clean them by an arbitrary time-to-live
-- while an upload could still finish; nonce uniqueness must survive retries.
CREATE TABLE allin_private.v2_privileged_storage_writer_nonces_review (
 nonce uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('begin','settle')),
 owner_id uuid NOT NULL,
 used_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE allin_private.v2_privileged_storage_writer_nonces_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_privileged_storage_writer_nonces_review
 FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE allin_private.v2_privileged_storage_write_leases_review
 ADD COLUMN writer_sha256_review text
 CHECK(writer_sha256_review IS NULL OR writer_sha256_review ~ '^[0-9a-f]{64}$');

-- Internal verification is not exposed by PostgREST. A service_role caller
-- may execute ONLY attested RPCs, never read the key or grant its own lease.
CREATE FUNCTION allin_private.v2_verify_storage_writer_attestation_review(
 p_action text,p_owner uuid,p_bucket text,p_path text,p_operation text,
 p_hash text,p_lease uuid,p_nonce uuid,p_epoch bigint,p_hmac text
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $verify$
DECLARE v_key bytea; v_message text; v_expected text;
BEGIN
 IF p_action NOT IN ('begin','settle') OR p_owner IS NULL OR
    p_nonce IS NULL OR p_epoch IS NULL OR
     (p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$') OR
     (p_hmac IS NULL OR p_hmac !~ '^[0-9a-f]{64}$') OR
    p_path IS NULL OR p_path LIKE '%|%' OR p_path ~ '[[:cntrl:]]' OR
    p_bucket IS NULL OR p_bucket LIKE '%|%' OR
    p_operation NOT IN ('create','replace') OR
    pg_catalog.abs(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())::bigint-p_epoch)>120 OR
    (p_action='begin' AND p_lease IS NOT NULL) OR
    (p_action='settle' AND p_lease IS NULL)
 THEN RAISE EXCEPTION 'Writer attestation rejected' USING ERRCODE='42501'; END IF;
 SELECT secret INTO v_key
 FROM allin_private.v2_privileged_storage_writer_key_review
 WHERE singleton=true;
 IF v_key IS NULL THEN
  RAISE EXCEPTION 'Writer signing key not provisioned' USING ERRCODE='42501';
 END IF;
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
END $verify$;
REVOKE ALL ON FUNCTION
 allin_private.v2_verify_storage_writer_attestation_review(
 text,uuid,text,text,text,text,uuid,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- The old service-role granted 4-argument RPC is made inaccessible to ALL
-- ordinary API clients as part of the same approved activation transaction.
-- New attested SECURITY DEFINER RPC invokes it using its function-owner
-- privileges and binds the exact payload hash to the resulting lease.
CREATE FUNCTION public.v2_begin_privileged_storage_write_attested_review(
 p_owner_id uuid,p_bucket_id text,p_object_path text,p_operation text,
 p_sha256 text,p_nonce uuid,p_issued_epoch bigint,p_signature text
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $begin$
DECLARE v_id uuid;
BEGIN
 PERFORM allin_private.v2_verify_storage_writer_attestation_review(
  'begin',p_owner_id,p_bucket_id,p_object_path,p_operation,
  p_sha256,NULL,p_nonce,p_issued_epoch,p_signature);
 v_id:=public.v2_begin_privileged_storage_write_review(
  p_owner_id,p_bucket_id,p_object_path,p_operation);
 UPDATE allin_private.v2_privileged_storage_write_leases_review
 SET writer_sha256_review=p_sha256 WHERE owner_id=p_owner_id AND lease_id=v_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease hash binding failed' USING ERRCODE='42501'; END IF;
 RETURN v_id;
END $begin$;
REVOKE ALL ON FUNCTION public.v2_begin_privileged_storage_write_attested_review(
 uuid,text,text,text,text,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_begin_privileged_storage_write_attested_review(
 uuid,text,text,text,text,uuid,bigint,text) TO service_role;

CREATE FUNCTION public.v2_settle_privileged_storage_write_attested_review(
 p_owner_id uuid,p_lease_id uuid,p_nonce uuid,p_issued_epoch bigint,
 p_signature text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $settle$
DECLARE v_lease record;
BEGIN
 SELECT bucket_id,object_path,operation,writer_sha256_review,settled_at
 INTO v_lease FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=p_owner_id AND lease_id=p_lease_id FOR UPDATE;
 IF NOT FOUND OR v_lease.settled_at IS NOT NULL
    OR v_lease.writer_sha256_review IS NULL
 THEN RAISE EXCEPTION 'Attested unresolved lease required' USING ERRCODE='42501'; END IF;
 PERFORM allin_private.v2_verify_storage_writer_attestation_review(
  'settle',p_owner_id,v_lease.bucket_id,v_lease.object_path,
  v_lease.operation,v_lease.writer_sha256_review,p_lease_id,
  p_nonce,p_issued_epoch,p_signature);
 RETURN public.v2_settle_privileged_storage_write_review(p_owner_id,p_lease_id);
END $settle$;
REVOKE ALL ON FUNCTION public.v2_settle_privileged_storage_write_attested_review(
 uuid,uuid,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_settle_privileged_storage_write_attested_review(
 uuid,uuid,uuid,bigint,text) TO service_role;

-- Key security cutover: no direct, unsigned service-role lease entrypoints.
REVOKE ALL ON FUNCTION public.v2_begin_privileged_storage_write_review(
 uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_settle_privileged_storage_write_review(
 uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- The activation must fail closed until a distinct signing key has been
-- safely provisioned. Direct Storage REST, S3 and TUS provider bypasses
-- remain independent release blockers, not made safe by this candidate.
