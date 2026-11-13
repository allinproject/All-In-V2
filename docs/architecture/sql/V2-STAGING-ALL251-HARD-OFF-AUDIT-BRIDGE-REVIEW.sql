-- ALL-251 shared-staging additive compatibility, REVIEW ONLY.
-- Exact canonical OFF switch and minimal durable deletion audit schema.
-- No worker/function/provider job is created or activated.
DO $pre$
BEGIN
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_account_export_requests_candidate') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review') IS NULL
 OR pg_catalog.to_regclass('public.v2_coach_threads') IS NULL
 OR pg_catalog.to_regclass('public.v2_ingredients') IS NULL
 THEN RAISE EXCEPTION 'Existing staged ALL-251/Coach/Nutrition lifecycle unavailable'
 USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_processor_config') IS NOT NULL
 OR pg_catalog.to_regclass('allin_private.v2_account_deletion_execution_audit') IS NOT NULL
 THEN RAISE EXCEPTION 'Canonical safety/audit tables already installed; reconcile before retry'
 USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='allin_private.v2_account_deletion_requests'::pg_catalog.regclass
   AND t.tgname='v2_privileged_storage_write_fence_review' AND t.tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='auth.users'::pg_catalog.regclass
   AND t.tgname='v2_privileged_storage_auth_delete_fence_review' AND t.tgenabled='O')
 THEN RAISE EXCEPTION 'ALL-251 active Storage/AUTH deletion fences required'
 USING ERRCODE='42501'; END IF;
END $pre$;
-- Canonical source: 20261111123642_v2_account_deletion_processor_default_off_gate.sql
CREATE TABLE allin_private.v2_account_deletion_processor_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 execution_enabled boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT now(),
 change_reason text NOT NULL DEFAULT 'Processor not implemented or accepted'
);
INSERT INTO allin_private.v2_account_deletion_processor_config
 (singleton,execution_enabled) VALUES(true,false);
ALTER TABLE allin_private.v2_account_deletion_processor_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_deletion_processor_config
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_account_deletion_processor_config IS
 'Default OFF. Separate human-controlled privileged release gate. No automated deletion worker deployed.';
-- Canonical source: 20261111124645_v2_deletion_durable_minimal_execution_audit_and_receipts.sql
CREATE TABLE allin_private.v2_account_deletion_execution_audit (
 request_id uuid PRIMARY KEY,
 user_id uuid,
 status text NOT NULL CHECK(status IN ('processing','failed','completed')),
 started_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 failure_code text CHECK(failure_code IN ('auth_delete_failed','auth_verify_failed','completion_failed')),
 CONSTRAINT v2_deletion_audit_completion CHECK(
  (status='completed' AND completed_at IS NOT NULL AND user_id IS NULL AND failure_code IS NULL)
  OR (status<>'completed' AND completed_at IS NULL AND user_id IS NOT NULL)
 )
);
ALTER TABLE allin_private.v2_account_deletion_execution_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_deletion_execution_audit
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_account_deletion_execution_audit IS
 'Minimal request-ID completion/failure evidence surviving Auth cascade. Retention, operator response and future worker require privacy signoff. Never store email/messages/tokens.';
DO $post$
BEGIN
 IF (SELECT execution_enabled FROM allin_private.v2_account_deletion_processor_config
   WHERE singleton=true) IS DISTINCT FROM false
 OR pg_catalog.has_table_privilege('authenticated',
  'allin_private.v2_account_deletion_processor_config','SELECT,INSERT,UPDATE,DELETE')
 OR pg_catalog.has_table_privilege('service_role',
  'allin_private.v2_account_deletion_processor_config','SELECT,INSERT,UPDATE,DELETE')
 OR pg_catalog.has_table_privilege('anon',
  'allin_private.v2_account_deletion_execution_audit','SELECT,INSERT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'Canonical hard-OFF or no-client-access invariant failed'
 USING ERRCODE='42501'; END IF;
 RAISE NOTICE 'PASS ALL-251 additive OFF switch and private durable audit; worker absent';
END $post$;
