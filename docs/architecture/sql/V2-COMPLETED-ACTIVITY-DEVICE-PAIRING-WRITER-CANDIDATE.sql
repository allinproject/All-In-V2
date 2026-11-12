-- ALL-243 REVIEW ONLY. NO HOSTED MIGRATION OR CLIENT ROUTE.
-- Trusted registrar consumes a server-issued challenge only AFTER a separate
-- backend has verified native/provider/equipment ownership evidence.
-- Never interpret a mobile-supplied "certified" flag as attestation.
-- Dedicated registrar role is a server credential, never authenticated/API.
CREATE ROLE allin_v2_device_registrar LOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth,public,allin_private TO allin_v2_device_registrar;
GRANT SELECT(id) ON auth.users TO allin_v2_device_registrar;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO allin_v2_device_registrar;

-- Challenge is bound to exact verified athlete + active session + device and
-- provider before presenting it to an approved provider-specific verifier.
CREATE TABLE allin_private.v2_device_pairing_challenges_candidate(
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 device_ref text NOT NULL CHECK (length(device_ref) BETWEEN 1 AND 250
   AND device_ref=pg_catalog.btrim(device_ref)),
 provider text NOT NULL CHECK(provider IN ('apple_watch','apple_healthkit','supported_equipment')),
 issued_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes')
);
ALTER TABLE allin_private.v2_device_pairing_challenges_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_device_pairing_challenges_candidate
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE(consumed_at)
 ON allin_private.v2_device_pairing_challenges_candidate TO allin_v2_device_registrar;
CREATE POLICY v2_device_registrar_challenge_owner
 ON allin_private.v2_device_pairing_challenges_candidate
 FOR ALL TO allin_v2_device_registrar
 USING(owner_id=(SELECT auth.uid()))
 WITH CHECK(owner_id=(SELECT auth.uid()));

-- One physical device identity cannot silently be transferred to a second
-- owner; transfer requires explicit revocation and separately reviewed process.
CREATE UNIQUE INDEX v2_device_registration_one_owner_per_provider_device
 ON allin_private.v2_device_registrations_candidate(provider,device_ref);
GRANT SELECT,INSERT,UPDATE(revoked_at)
 ON allin_private.v2_device_registrations_candidate TO allin_v2_device_registrar;
CREATE POLICY v2_device_registrar_registration_owner
 ON allin_private.v2_device_registrations_candidate
 FOR ALL TO allin_v2_device_registrar
 USING(user_id=(SELECT auth.uid()))
 WITH CHECK(user_id=(SELECT auth.uid()));
GRANT EXECUTE ON FUNCTION auth.uid() TO allin_v2_device_registrar;

-- Append-only audit history survives revocation until account deletion.
CREATE TABLE allin_private.v2_device_pairing_audit_candidate(
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 device_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('paired','revoked')),
 session_id uuid NOT NULL,
 evidence_hash text CHECK(evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{64}$'),
 occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE allin_private.v2_device_pairing_audit_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_device_pairing_audit_candidate FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON allin_private.v2_device_pairing_audit_candidate TO allin_v2_device_registrar;
CREATE POLICY v2_device_registrar_audit_insert
 ON allin_private.v2_device_pairing_audit_candidate FOR INSERT TO allin_v2_device_registrar
 WITH CHECK(owner_id=(SELECT auth.uid()));

-- Server-only SQL capability: all rows + canonical owner lock in ONE transaction.
-- The registrar is not the source of native/provider certification. The caller
-- MUST verify the proof with a trusted provider adapter independently.
CREATE FUNCTION allin_private.v2_device_pair_verified_candidate(
 p_challenge_id uuid,p_device_id uuid,p_owner_id uuid,p_session_id uuid,
 p_device_ref text,p_provider text,p_attestation_kind text,
 p_attestation_hash text,p_audit_id uuid
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $pair$
DECLARE v_claim allin_private.v2_device_pairing_challenges_candidate%ROWTYPE;
BEGIN
 IF current_user<>'allin_v2_device_registrar' THEN
  RAISE EXCEPTION 'Trusted registrar required' USING ERRCODE='42501';
 END IF;
 IF p_owner_id IS NULL OR p_owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN
  RAISE EXCEPTION 'Verified owner required' USING ERRCODE='42501';
 END IF;
 IF p_attestation_hash !~ '^[0-9a-f]{64}$' OR p_attestation_hash IS NULL THEN
  RAISE EXCEPTION 'Verified evidence digest required' USING ERRCODE='22023';
 END IF;
 -- Shared lock serializes pair/revoke with source ingestion and invalidation.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-metric:'||p_owner_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.sessions
  WHERE id=p_session_id AND user_id=p_owner_id
    AND (not_after IS NULL OR not_after>pg_catalog.now())) THEN
  RAISE EXCEPTION 'Active Auth session required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_claim FROM allin_private.v2_device_pairing_challenges_candidate
 WHERE id=p_challenge_id AND owner_id=p_owner_id AND session_id=p_session_id
   AND device_ref=p_device_ref AND provider=p_provider AND consumed_at IS NULL
   AND expires_at>pg_catalog.now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pairing challenge invalid or consumed' USING ERRCODE='42501'; END IF;
 IF p_provider='supported_equipment' AND p_attestation_kind<>'equipment_paired'
   OR p_provider IN ('apple_watch','apple_healthkit') AND
      p_attestation_kind NOT IN ('native_owner_verified','provider_account_verified') THEN
  RAISE EXCEPTION 'Unapproved device evidence kind' USING ERRCODE='42501';
 END IF;
 UPDATE allin_private.v2_device_pairing_challenges_candidate
 SET consumed_at=pg_catalog.now() WHERE id=p_challenge_id;
 INSERT INTO allin_private.v2_device_registrations_candidate(
  id,user_id,device_ref,provider,certified_at,attestation_kind,attestation_reference_hash)
 VALUES(p_device_id,p_owner_id,p_device_ref,p_provider,pg_catalog.now(),
  p_attestation_kind,p_attestation_hash);
 INSERT INTO allin_private.v2_device_pairing_audit_candidate(
  id,owner_id,device_id,event_type,session_id,evidence_hash)
 VALUES(p_audit_id,p_owner_id,p_device_id,'paired',p_session_id,p_attestation_hash);
 RETURN 'paired';
END;
$pair$;

CREATE FUNCTION allin_private.v2_device_revoke_candidate(
 p_device_id uuid,p_owner_id uuid,p_session_id uuid,p_audit_id uuid
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $revoke$
DECLARE v_device allin_private.v2_device_registrations_candidate%ROWTYPE;
BEGIN
 IF current_user<>'allin_v2_device_registrar' OR
  p_owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN
  RAISE EXCEPTION 'Trusted owner registrar required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-metric:'||p_owner_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.sessions
  WHERE id=p_session_id AND user_id=p_owner_id
    AND (not_after IS NULL OR not_after>pg_catalog.now())) THEN
  RAISE EXCEPTION 'Active Auth session required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_device FROM allin_private.v2_device_registrations_candidate
 WHERE id=p_device_id AND user_id=p_owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned registered device required' USING ERRCODE='42501'; END IF;
 IF v_device.revoked_at IS NOT NULL THEN RETURN 'already_revoked'; END IF;
 UPDATE allin_private.v2_device_registrations_candidate
 SET revoked_at=pg_catalog.now() WHERE id=p_device_id AND user_id=p_owner_id;
 INSERT INTO allin_private.v2_device_pairing_audit_candidate(
  id,owner_id,device_id,event_type,session_id)
 VALUES(p_audit_id,p_owner_id,p_device_id,'revoked',p_session_id);
 RETURN 'revoked';
END;
$revoke$;
REVOKE ALL ON FUNCTION allin_private.v2_device_pair_verified_candidate(
 uuid,uuid,uuid,uuid,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION allin_private.v2_device_revoke_candidate(
 uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_device_pair_verified_candidate(
 uuid,uuid,uuid,uuid,text,text,text,text,uuid) TO allin_v2_device_registrar;
GRANT EXECUTE ON FUNCTION allin_private.v2_device_revoke_candidate(
 uuid,uuid,uuid,uuid) TO allin_v2_device_registrar;
-- Irreversible private provenance: even a registrar credential cannot
-- reopen a consumed challenge, un-revoke a device or alter certified identity.
-- Only fresh server verification may create a new record (unique device scope
-- requires separate explicit transfer/recovery review).
CREATE FUNCTION allin_private.v2_device_pairing_immutability_guard_candidate()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $guard$
BEGIN
 IF TG_TABLE_NAME='v2_device_pairing_challenges_candidate' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR
   NEW.owner_id IS DISTINCT FROM OLD.owner_id OR
   NEW.session_id IS DISTINCT FROM OLD.session_id OR
   NEW.device_ref IS DISTINCT FROM OLD.device_ref OR
   NEW.provider IS DISTINCT FROM OLD.provider OR
   NEW.issued_at IS DISTINCT FROM OLD.issued_at OR
   NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
   OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
   RAISE EXCEPTION 'Pairing challenge cannot be reopened or rebound'
    USING ERRCODE='42501';
  END IF;
 ELSIF TG_TABLE_NAME='v2_device_registrations_candidate' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR
   NEW.user_id IS DISTINCT FROM OLD.user_id OR
   NEW.device_ref IS DISTINCT FROM OLD.device_ref OR
   NEW.provider IS DISTINCT FROM OLD.provider OR
   NEW.certified_at IS DISTINCT FROM OLD.certified_at OR
   NEW.attestation_kind IS DISTINCT FROM OLD.attestation_kind OR
   NEW.attestation_reference_hash IS DISTINCT FROM OLD.attestation_reference_hash OR
   OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
   RAISE EXCEPTION 'Certified device cannot be transferred or un-revoked'
    USING ERRCODE='42501';
  END IF;
 ELSE
  RAISE EXCEPTION 'Unexpected device provenance table'
   USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-metric:'||
  CASE WHEN TG_TABLE_NAME='v2_device_pairing_challenges_candidate'
    THEN OLD.owner_id::text ELSE OLD.user_id::text END,0));
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION allin_private.v2_device_pairing_immutability_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER v2_pairing_challenge_immutable_guard
 BEFORE UPDATE ON allin_private.v2_device_pairing_challenges_candidate
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_device_pairing_immutability_guard_candidate();
CREATE TRIGGER v2_registered_device_immutable_guard
 BEFORE UPDATE ON allin_private.v2_device_registrations_candidate
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_device_pairing_immutability_guard_candidate();

-- No client can invoke these functions or obtain registrar membership.
-- No SECURITY DEFINER bypass; no client INSERT on registry/challenge/audit.
