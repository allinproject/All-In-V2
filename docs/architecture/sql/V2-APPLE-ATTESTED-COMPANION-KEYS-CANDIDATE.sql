-- ALL-243 REVIEW ONLY; not a hosted migration. Apple iPhone App Attest
-- keys must be enrolled only by a distinct, approved Apple attestation
-- certificate-chain verifier (NOT the app, phone or pairing endpoint).
-- No public/native client can create or promote these trust records.
CREATE TABLE allin_private.v2_apple_attested_companion_keys_candidate(
 key_id text PRIMARY KEY CHECK (length(key_id) BETWEEN 10 AND 300),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 apple_app_id text NOT NULL,
 public_key_spki_base64url text NOT NULL CHECK(length(public_key_spki_base64url) BETWEEN 32 AND 512),
 apple_attestation_verified_at timestamptz NOT NULL,
 assertion_sign_count bigint NOT NULL DEFAULT 0 CHECK(assertion_sign_count BETWEEN 0 AND 4294967295),
 revoked_at timestamptz,
 CHECK(revoked_at IS NULL OR revoked_at>=apple_attestation_verified_at)
);
ALTER TABLE allin_private.v2_apple_attested_companion_keys_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_apple_attested_companion_keys_candidate
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingest_operator;
-- Pairing registrar can read existing independently-verified keys and can
-- advance ONLY the strictly monotone counter, not certify/rebind a key.
GRANT SELECT,UPDATE(assertion_sign_count)
 ON allin_private.v2_apple_attested_companion_keys_candidate
 TO allin_v2_device_registrar;
CREATE POLICY v2_pairing_registrar_attested_phone_read
 ON allin_private.v2_apple_attested_companion_keys_candidate
 FOR SELECT TO allin_v2_device_registrar
 USING(owner_id=(SELECT auth.uid()));
CREATE POLICY v2_pairing_registrar_attested_phone_counter_update
 ON allin_private.v2_apple_attested_companion_keys_candidate
 FOR UPDATE TO allin_v2_device_registrar
 USING(owner_id=(SELECT auth.uid()))
 WITH CHECK(owner_id=(SELECT auth.uid()));
-- Pairing challenge SELECT is already registrar-owned. The watch key
-- fingerprint becomes the existing challenge.device_ref.
COMMENT ON TABLE allin_private.v2_apple_attested_companion_keys_candidate IS
 'Approved Apple App Attest enrolment ONLY; proves iPhone app instance, not Apple Watch hardware identity. No enrolled key -> watch pairing fails closed.';


-- ALL-243: dedicated App Attest ENROLLER. This does not validate the Apple
-- receipt or establish a public enrollment endpoint. NOLOGIN means the only
-- supported activation is a separately reviewed trusted service credential
-- and explicit SET ROLE membership. The pairing registrar CANNOT enroll.
CREATE ROLE allin_v2_appattest_enroller NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth,allin_private TO allin_v2_appattest_enroller;
GRANT SELECT(id) ON auth.users TO allin_v2_appattest_enroller;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO allin_v2_appattest_enroller;
GRANT EXECUTE ON FUNCTION auth.uid() TO allin_v2_appattest_enroller;

CREATE TABLE allin_private.v2_appattest_enrollment_challenges_candidate(
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 apple_app_id text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 issued_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes')
);
ALTER TABLE allin_private.v2_appattest_enrollment_challenges_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_appattest_enrollment_challenges_candidate
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_device_registrar;
GRANT SELECT,INSERT,UPDATE(consumed_at)
 ON allin_private.v2_appattest_enrollment_challenges_candidate
 TO allin_v2_appattest_enroller;
CREATE POLICY v2_appattest_enroller_challenge_owner
 ON allin_private.v2_appattest_enrollment_challenges_candidate
 FOR ALL TO allin_v2_appattest_enroller
 USING(owner_id=(SELECT auth.uid()))
 WITH CHECK(owner_id=(SELECT auth.uid()));

-- A real Apple receipt validator must bind app ID, attested public key,
-- signed receipt, five-minute freshness and Apple receipt certificate chain.
-- These hashes are provenance/retention handles, not a substitute for that.
ALTER TABLE allin_private.v2_apple_attested_companion_keys_candidate
 ADD COLUMN receipt_sha256 text CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 ADD COLUMN leaf_certificate_sha256 text CHECK(leaf_certificate_sha256 ~ '^[0-9a-f]{64}$'),
 ADD COLUMN attestation_environment text CHECK(attestation_environment IN ('sandbox','production'));
GRANT INSERT ON allin_private.v2_apple_attested_companion_keys_candidate
 TO allin_v2_appattest_enroller;
CREATE POLICY v2_appattest_enroller_key_insert
 ON allin_private.v2_apple_attested_companion_keys_candidate
 FOR INSERT TO allin_v2_appattest_enroller
 WITH CHECK(owner_id=(SELECT auth.uid()));

CREATE FUNCTION allin_private.v2_appattest_enroll_verified_key_candidate(
 p_challenge uuid,p_owner uuid,p_session uuid,p_key text,p_app_id text,
 p_environment text,p_public_spki text,p_receipt_hash text,
 p_leaf_cert_hash text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $enroll$
BEGIN
 IF current_user<>'allin_v2_appattest_enroller' OR
    p_owner IS DISTINCT FROM (SELECT auth.uid()) THEN
  RAISE EXCEPTION 'Trusted Apple attestation enroller required' USING ERRCODE='42501';
 END IF;
 IF p_receipt_hash !~ '^[0-9a-f]{64}$' OR
    p_leaf_cert_hash !~ '^[0-9a-f]{64}$' OR
    length(p_public_spki) NOT BETWEEN 32 AND 512 OR
    length(p_key) NOT BETWEEN 10 AND 300 THEN
  RAISE EXCEPTION 'Verified Apple evidence fields required' USING ERRCODE='22023';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-metric:'||p_owner::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.sessions
  WHERE id=p_session AND user_id=p_owner
   AND (not_after IS NULL OR not_after>pg_catalog.now())) THEN
  RAISE EXCEPTION 'Active verified Auth session required' USING ERRCODE='42501';
 END IF;
 -- Row lock prevents two concurrent cert-verification callbacks from using
 -- one challenge; a failing key insert rolls this consumption back.
 PERFORM 1 FROM allin_private.v2_appattest_enrollment_challenges_candidate
  WHERE id=p_challenge AND owner_id=p_owner AND session_id=p_session
    AND apple_app_id=p_app_id AND environment=p_environment
    AND consumed_at IS NULL AND expires_at>pg_catalog.now() FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Expired or consumed App Attest enrollment challenge'
   USING ERRCODE='42501';
 END IF;
 UPDATE allin_private.v2_appattest_enrollment_challenges_candidate
  SET consumed_at=pg_catalog.now() WHERE id=p_challenge;
 INSERT INTO allin_private.v2_apple_attested_companion_keys_candidate(
  key_id,owner_id,apple_app_id,public_key_spki_base64url,
  apple_attestation_verified_at,assertion_sign_count,
  receipt_sha256,leaf_certificate_sha256,attestation_environment)
 VALUES (p_key,p_owner,p_app_id,p_public_spki,pg_catalog.now(),0,
  p_receipt_hash,p_leaf_cert_hash,p_environment);
 RETURN 'enrolled';
END;
$enroll$;
REVOKE ALL ON FUNCTION allin_private.v2_appattest_enroll_verified_key_candidate(
 uuid,uuid,uuid,text,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_device_registrar,
 allin_v2_ingest_operator;
GRANT EXECUTE ON FUNCTION allin_private.v2_appattest_enroll_verified_key_candidate(
 uuid,uuid,uuid,text,text,text,text,text,text)
 TO allin_v2_appattest_enroller;
-- No one in the app, API or pairing registrar can call this function or
-- insert Apple trust records. The enroller role is deliberately NOLOGIN.
-- Operational activation requires independent Apple receipt verification,
-- secure enroller credential/role deployment, and explicit owner approval.

-- Trusted server operator can SET but not inherit enrollment capabilities.
-- Credentials must never be provisioned to an app or generic Edge role.
CREATE ROLE allin_v2_appattest_enrollment_operator LOGIN NOINHERIT NOBYPASSRLS;
GRANT allin_v2_appattest_enroller TO allin_v2_appattest_enrollment_operator
 WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
-- No password or network grants created in review-only candidate.
