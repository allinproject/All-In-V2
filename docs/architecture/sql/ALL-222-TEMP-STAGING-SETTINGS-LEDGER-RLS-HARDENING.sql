-- ALL-222 temporary staging only, 2026-11-13.
-- Narrow defense-in-depth RLS correction; preserves existing SECURITY DEFINER
-- owner RPC and all ALL-251 Storage/deletion grants and gates.
-- Do not apply to canonical V2 (already enabled) or any other environment.
DO $guard$
DECLARE v_oid oid := to_regclass('allin_private.v2_profile_settings_actions');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Settings action ledger absent; abort staging-only RLS hardening';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) <> 'postgres' FROM pg_class WHERE oid=v_oid) THEN
    RAISE EXCEPTION 'Unexpected owner; abort staging-only RLS hardening';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid=v_oid) THEN
    RAISE EXCEPTION 'Ledger RLS already enabled; inspect concurrent migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=v_oid) THEN
    RAISE EXCEPTION 'Unexpected existing ledger RLS policies';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role')
      AND (
        has_table_privilege(oid,v_oid,'SELECT')
        OR has_table_privilege(oid,v_oid,'INSERT')
        OR has_table_privilege(oid,v_oid,'UPDATE')
        OR has_table_privilege(oid,v_oid,'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected API role direct table grant; abort';
  END IF;
END
$guard$;

ALTER TABLE allin_private.v2_profile_settings_actions ENABLE ROW LEVEL SECURITY;
