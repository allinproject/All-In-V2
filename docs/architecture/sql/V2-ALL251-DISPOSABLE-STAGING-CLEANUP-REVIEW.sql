-- ALL-251 disposable STAGING ONLY. This is a reviewed test-fixture cleanup,
-- not an operational user-deletion cancellation API or release migration.
-- A synthetic Auth user with a real session can remove ONLY their own
-- requested test deletion, and only if there are no unresolved write leases.
-- Must be installed only in dedicated disposable staging; never production.
CREATE FUNCTION public.v2_all251_http_matrix_cleanup_deletion(
 p_expected_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path=''
AS $body$
DECLARE v_owner uuid := auth.uid();
BEGIN
 IF v_owner IS NULL OR p_expected_user_id IS DISTINCT FROM v_owner
    OR NOT EXISTS(
     SELECT 1 FROM auth.users u
     WHERE u.id=v_owner
       AND u.raw_app_meta_data @> '{"all251_httpmatrix":true}'::jsonb
       AND u.email LIKE 'all251-http-%@example.invalid'
    )
 THEN
  RAISE EXCEPTION 'Disposable test owner required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||v_owner::text,0));
 IF EXISTS(
  SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review
  WHERE owner_id=v_owner AND settled_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Open write lease blocks test cleanup' USING ERRCODE='42501';
 END IF;
 DELETE FROM allin_private.v2_account_deletion_requests
 WHERE user_id=v_owner AND status='requested';
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Expected synthetic requested row missing'
   USING ERRCODE='42501';
 END IF;
 RETURN true;
END
$body$;
REVOKE ALL ON FUNCTION public.v2_all251_http_matrix_cleanup_deletion(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_all251_http_matrix_cleanup_deletion(uuid)
 TO authenticated;
