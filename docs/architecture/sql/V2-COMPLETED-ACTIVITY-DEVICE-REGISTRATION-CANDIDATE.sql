-- ALL-243 REVIEW ONLY: source-owned registered-device evidence boundary.
-- NOT a migration. Do NOT deploy or grant API/client access.
-- Extends canonical source provenance; never a duplicate activity store.
CREATE TABLE allin_private.v2_device_registrations_candidate(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 device_ref text NOT NULL CHECK(length(device_ref) BETWEEN 1 AND 250
   AND device_ref=pg_catalog.btrim(device_ref)),
 provider text NOT NULL CHECK(provider IN
   ('apple_healthkit','apple_watch','supported_equipment')),
 certified_at timestamptz NOT NULL,
 revoked_at timestamptz,
 attestation_kind text NOT NULL CHECK(attestation_kind IN
  ('native_owner_verified','provider_account_verified','equipment_paired')),
 attestation_reference_hash text NOT NULL CHECK(
  attestation_reference_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(user_id,device_ref,provider),
 CHECK(revoked_at IS NULL OR revoked_at>=certified_at)
);
ALTER TABLE allin_private.v2_device_registrations_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_device_registrations_candidate
 FROM PUBLIC,anon,authenticated,service_role;
-- The dedicated trusted ingest operator is granted only the SELECT required
-- for authorization at an independently reviewed deployment. Device registration
-- creation/revocation requires a separate server-verified native owner process.
COMMENT ON TABLE allin_private.v2_device_registrations_candidate IS
 'ALL-243 review-only device binding; presence is evidence of server registration, not cryptographic HealthKit or Apple Watch attestation.';
