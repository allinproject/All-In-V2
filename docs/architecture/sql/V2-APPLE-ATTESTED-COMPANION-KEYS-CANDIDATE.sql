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
