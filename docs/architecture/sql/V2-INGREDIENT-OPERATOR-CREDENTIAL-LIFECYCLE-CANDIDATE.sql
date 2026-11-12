-- ALL-251 / ALL-222 private reviewer identity and credential lifecycle candidate.
-- REVIEW ONLY. NOT A SUPABASE MIGRATION. No login, password or secret created.
-- Applies AFTER V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql.
-- Identity provider verification and a unique DB login are operator-controlled,
-- off-database duties. This SQL stores references, never passwords/tokens.

ALTER TABLE allin_private.v2_ingredient_review_operators
  ADD COLUMN IF NOT EXISTS principal_kind text NOT NULL DEFAULT 'human' CHECK (principal_kind IN ('human','workload')),
  ADD COLUMN IF NOT EXISTS identity_issuer text,
  ADD COLUMN IF NOT EXISTS identity_subject text,
  ADD COLUMN IF NOT EXISTS credential_vault_reference text,
  ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS credential_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE allin_private.v2_ingredient_review_operators
  ADD CONSTRAINT v2_ingredient_operator_verified_activation CHECK (
    NOT enabled OR (
      identity_issuer IS NOT NULL AND length(trim(identity_issuer))>=8 AND
      identity_subject IS NOT NULL AND length(trim(identity_subject))>=8 AND
      credential_vault_reference IS NOT NULL AND length(trim(credential_vault_reference))>=12 AND
      identity_verified_at IS NOT NULL AND
      credential_expires_at IS NOT NULL AND credential_expires_at>identity_verified_at AND
      revoked_at IS NULL
    )
  );
-- Workload records use the SAME restricted registry and review writer. The
-- canonical database login is provisioned out-of-band: a dedicated, non-shared
-- LOGIN role with NOINHERIT/NOBYPASSRLS and no direct table privileges.
-- No workload can authorize itself or obtain the role grant through an API.
ALTER TABLE allin_private.v2_ingredient_review_operators
  ADD CONSTRAINT v2_ingredient_workload_identity_scope CHECK (
    principal_kind<>'workload' OR (
      login_role::text ~ '^allin_ing_workload_[a-z0-9_]{6,35}
  ON allin_private.v2_ingredient_review_operators(identity_issuer,identity_subject)
  WHERE identity_issuer IS NOT NULL AND identity_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS v2_ingredient_operator_vault_reference_unique
  ON allin_private.v2_ingredient_review_operators(credential_vault_reference)
  WHERE credential_vault_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_operator_credential_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_role name NOT NULL,
  actor_db_login name NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('enrolled','changed','disabled','revoked')),
  previous_enabled boolean,
  next_enabled boolean NOT NULL,
  previous_expires_at timestamptz,
  next_expires_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE allin_private.v2_ingredient_operator_credential_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_operator_credential_events
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;
REVOKE ALL ON SEQUENCE allin_private.v2_ingredient_operator_credential_events_event_id_seq
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;

CREATE OR REPLACE FUNCTION allin_private.v2_audit_ingredient_operator_credential_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,allin_private,pg_temp AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO allin_private.v2_ingredient_operator_credential_events
      (login_role,actor_db_login,event_type,previous_enabled,next_enabled,next_expires_at)
    VALUES(NEW.login_role,session_user,'enrolled',NULL,NEW.enabled,NEW.credential_expires_at);
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.login_role IS DISTINCT FROM NEW.login_role
       OR OLD.identity_issuer IS DISTINCT FROM NEW.identity_issuer
       OR OLD.identity_subject IS DISTINCT FROM NEW.identity_subject
       OR OLD.principal_kind IS DISTINCT FROM NEW.principal_kind THEN
      RAISE EXCEPTION 'operator identity immutable; disable and enroll a new login'
        USING ERRCODE='23514';
    END IF;
    INSERT INTO allin_private.v2_ingredient_operator_credential_events
      (login_role,actor_db_login,event_type,previous_enabled,next_enabled,
       previous_expires_at,next_expires_at)
    VALUES(NEW.login_role,session_user,
      CASE WHEN NEW.revoked_at IS NOT NULL THEN 'revoked'
           WHEN NOT NEW.enabled THEN 'disabled' ELSE 'changed' END,
      OLD.enabled,NEW.enabled,OLD.credential_expires_at,NEW.credential_expires_at);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION allin_private.v2_audit_ingredient_operator_credential_change()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS v2_ingredient_operator_credential_change
 ON allin_private.v2_ingredient_review_operators;
CREATE TRIGGER v2_ingredient_operator_credential_change
 AFTER INSERT OR UPDATE ON allin_private.v2_ingredient_review_operators
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_audit_ingredient_operator_credential_change();

-- Registry enrollment cannot disappear without an immutable disable/revoke
-- record; delete requires separately approved purge/retention procedures.
CREATE OR REPLACE FUNCTION allin_private.v2_deny_ingredient_operator_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $delete$
BEGIN
  RAISE EXCEPTION 'operator enrollment cannot be deleted; revoke instead'
    USING ERRCODE='42501';
END;
$delete$;
REVOKE ALL ON FUNCTION allin_private.v2_deny_ingredient_operator_deletion()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS v2_ingredient_operator_no_delete
 ON allin_private.v2_ingredient_review_operators;
CREATE TRIGGER v2_ingredient_operator_no_delete
 BEFORE DELETE ON allin_private.v2_ingredient_review_operators
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_operator_deletion();

DROP TRIGGER IF EXISTS v2_ingredient_operator_credential_events_immutable
 ON allin_private.v2_ingredient_operator_credential_events;
CREATE TRIGGER v2_ingredient_operator_credential_events_immutable
 BEFORE UPDATE OR DELETE ON allin_private.v2_ingredient_operator_credential_events
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_review_audit_change();

-- Runtime gate must additionally enforce clock_timestamp()<expires_at.
-- Operator provisioning is NOT enabled via a public SECURITY DEFINER RPC.
-- A real credential must be generated/rotated in an approved secrets manager,
-- individually mapped to an IdP-reviewed human subject and a dedicated DB
-- login; no service_role/pooled/mobile credential may be enrolled.
-- Service identity is not human MFA. Operators must separately verify a
-- workload deployment identity, ephemeral/restricted server context, credential
-- custody, issuer/subject mapping, expiry, rotation and immediate revocation.
-- It is not Supabase's built-in service_role and cannot be called by clients.
-- Workload accounts are confined to prepublication normalization transitions;
-- the private writer enforces that even if the login is a reviewer-role member.
-- Suspend/revoke: owner disables registry, revokes membership and DB LOGIN,
-- rotates credentials and terminates existing backend sessions. The SQL
-- function checks disabled/expired on each invocation; no role is created here.
 AND
      identity_issuer='allin-v2-internal-workload' AND
      identity_subject ~ '^ingest-[a-z0-9-]{8,80}
  ON allin_private.v2_ingredient_review_operators(identity_issuer,identity_subject)
  WHERE identity_issuer IS NOT NULL AND identity_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS v2_ingredient_operator_vault_reference_unique
  ON allin_private.v2_ingredient_review_operators(credential_vault_reference)
  WHERE credential_vault_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_operator_credential_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_role name NOT NULL,
  actor_db_login name NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('enrolled','changed','disabled','revoked')),
  previous_enabled boolean,
  next_enabled boolean NOT NULL,
  previous_expires_at timestamptz,
  next_expires_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE allin_private.v2_ingredient_operator_credential_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_operator_credential_events
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;
REVOKE ALL ON SEQUENCE allin_private.v2_ingredient_operator_credential_events_event_id_seq
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;

CREATE OR REPLACE FUNCTION allin_private.v2_audit_ingredient_operator_credential_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,allin_private,pg_temp AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO allin_private.v2_ingredient_operator_credential_events
      (login_role,actor_db_login,event_type,previous_enabled,next_enabled,next_expires_at)
    VALUES(NEW.login_role,session_user,'enrolled',NULL,NEW.enabled,NEW.credential_expires_at);
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.login_role IS DISTINCT FROM NEW.login_role
       OR OLD.identity_issuer IS DISTINCT FROM NEW.identity_issuer
       OR OLD.identity_subject IS DISTINCT FROM NEW.identity_subject THEN
      RAISE EXCEPTION 'operator identity immutable; disable and enroll a new login'
        USING ERRCODE='23514';
    END IF;
    INSERT INTO allin_private.v2_ingredient_operator_credential_events
      (login_role,actor_db_login,event_type,previous_enabled,next_enabled,
       previous_expires_at,next_expires_at)
    VALUES(NEW.login_role,session_user,
      CASE WHEN NEW.revoked_at IS NOT NULL THEN 'revoked'
           WHEN NOT NEW.enabled THEN 'disabled' ELSE 'changed' END,
      OLD.enabled,NEW.enabled,OLD.credential_expires_at,NEW.credential_expires_at);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION allin_private.v2_audit_ingredient_operator_credential_change()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS v2_ingredient_operator_credential_change
 ON allin_private.v2_ingredient_review_operators;
CREATE TRIGGER v2_ingredient_operator_credential_change
 AFTER INSERT OR UPDATE ON allin_private.v2_ingredient_review_operators
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_audit_ingredient_operator_credential_change();

-- Registry enrollment cannot disappear without an immutable disable/revoke
-- record; delete requires separately approved purge/retention procedures.
CREATE OR REPLACE FUNCTION allin_private.v2_deny_ingredient_operator_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $delete$
BEGIN
  RAISE EXCEPTION 'operator enrollment cannot be deleted; revoke instead'
    USING ERRCODE='42501';
END;
$delete$;
REVOKE ALL ON FUNCTION allin_private.v2_deny_ingredient_operator_deletion()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS v2_ingredient_operator_no_delete
 ON allin_private.v2_ingredient_review_operators;
CREATE TRIGGER v2_ingredient_operator_no_delete
 BEFORE DELETE ON allin_private.v2_ingredient_review_operators
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_operator_deletion();

DROP TRIGGER IF EXISTS v2_ingredient_operator_credential_events_immutable
 ON allin_private.v2_ingredient_operator_credential_events;
CREATE TRIGGER v2_ingredient_operator_credential_events_immutable
 BEFORE UPDATE OR DELETE ON allin_private.v2_ingredient_operator_credential_events
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_review_audit_change();

-- Runtime gate must additionally enforce clock_timestamp()<expires_at.
-- Operator provisioning is NOT enabled via a public SECURITY DEFINER RPC.
-- A real credential must be generated/rotated in an approved secrets manager,
-- individually mapped to an IdP-reviewed human subject and a dedicated DB
-- login; no service_role/pooled/mobile credential may be enrolled.
-- Suspend/revoke: owner disables registry, revokes membership and DB LOGIN,
-- rotates credentials and terminates existing backend sessions. The SQL
-- function checks disabled/expired on each invocation; no role is created here.

    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS v2_ingredient_operator_identity_unique
  ON allin_private.v2_ingredient_review_operators(identity_issuer,identity_subject)
  WHERE identity_issuer IS NOT NULL AND identity_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS v2_ingredient_operator_vault_reference_unique
  ON allin_private.v2_ingredient_review_operators(credential_vault_reference)
  WHERE credential_vault_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS allin_private.v2_ingredient_operator_credential_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_role name NOT NULL,
  actor_db_login name NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('enrolled','changed','disabled','revoked')),
  previous_enabled boolean,
  next_enabled boolean NOT NULL,
  previous_expires_at timestamptz,
  next_expires_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE allin_private.v2_ingredient_operator_credential_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_ingredient_operator_credential_events
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;
REVOKE ALL ON SEQUENCE allin_private.v2_ingredient_operator_credential_events_event_id_seq
 FROM PUBLIC,anon,authenticated,service_role,allin_v2_ingredient_reviewer;

CREATE OR REPLACE FUNCTION allin_private.v2_audit_ingredient_operator_credential_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,allin_private,pg_temp AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO allin_private.v2_ingredient_operator_credential_events
      (login_role,actor_db_login,event_type,previous_enabled,next_enabled,next_expires_at)
    VALUES(NEW.login_role,session_user,'enrolled',NULL,NEW.enabled,NEW.credential_expires_at);
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.login_role IS DISTINCT FROM NEW.login_role
       OR OLD.identity_issuer IS DISTINCT FROM NEW.identity_issuer
       OR OLD.identity_subject IS DISTINCT FROM NEW.identity_subject THEN
      RAISE EXCEPTION 'operator identity immutable; disable and enroll a new login'
        USING ERRCODE='23514';
    END IF;
    INSERT INTO allin_private.v2_ingredient_operator_credential_events
      (login_role,actor_db_login,event_type,previous_enabled,next_enabled,
       previous_expires_at,next_expires_at)
    VALUES(NEW.login_role,session_user,
      CASE WHEN NEW.revoked_at IS NOT NULL THEN 'revoked'
           WHEN NOT NEW.enabled THEN 'disabled' ELSE 'changed' END,
      OLD.enabled,NEW.enabled,OLD.credential_expires_at,NEW.credential_expires_at);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION allin_private.v2_audit_ingredient_operator_credential_change()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS v2_ingredient_operator_credential_change
 ON allin_private.v2_ingredient_review_operators;
CREATE TRIGGER v2_ingredient_operator_credential_change
 AFTER INSERT OR UPDATE ON allin_private.v2_ingredient_review_operators
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_audit_ingredient_operator_credential_change();

-- Registry enrollment cannot disappear without an immutable disable/revoke
-- record; delete requires separately approved purge/retention procedures.
CREATE OR REPLACE FUNCTION allin_private.v2_deny_ingredient_operator_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $delete$
BEGIN
  RAISE EXCEPTION 'operator enrollment cannot be deleted; revoke instead'
    USING ERRCODE='42501';
END;
$delete$;
REVOKE ALL ON FUNCTION allin_private.v2_deny_ingredient_operator_deletion()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS v2_ingredient_operator_no_delete
 ON allin_private.v2_ingredient_review_operators;
CREATE TRIGGER v2_ingredient_operator_no_delete
 BEFORE DELETE ON allin_private.v2_ingredient_review_operators
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_operator_deletion();

DROP TRIGGER IF EXISTS v2_ingredient_operator_credential_events_immutable
 ON allin_private.v2_ingredient_operator_credential_events;
CREATE TRIGGER v2_ingredient_operator_credential_events_immutable
 BEFORE UPDATE OR DELETE ON allin_private.v2_ingredient_operator_credential_events
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_ingredient_review_audit_change();

-- Runtime gate must additionally enforce clock_timestamp()<expires_at.
-- Operator provisioning is NOT enabled via a public SECURITY DEFINER RPC.
-- A real credential must be generated/rotated in an approved secrets manager,
-- individually mapped to an IdP-reviewed human subject and a dedicated DB
-- login; no service_role/pooled/mobile credential may be enrolled.
-- Suspend/revoke: owner disables registry, revokes membership and DB LOGIN,
-- rotates credentials and terminates existing backend sessions. The SQL
-- function checks disabled/expired on each invocation; no role is created here.
