-- ALL-251 DISPOSABLE STAGING ONLY: synthetic R2 fixture cleanup permission.
-- NO real account deletion, no R2 bytes modified by this function.
-- Requires (a) real owner JWT and auth.sessions row, (b) synthetic Auth
-- account metadata, (c) pending synthetic deletion request in existing
-- canonical deletion state, (d) zero unresolved privileged Storage leases.
-- Do not deploy in production or generalize to normal account users.
CREATE FUNCTION public.v2_all251_owner_r2_fixture_cleanup_allowed_review()
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=''
AS $cleanup$
DECLARE
 v_owner uuid:=auth.uid();
 v_session uuid;
BEGIN
 IF v_owner IS NULL OR auth.jwt()->>'session_id' IS NULL OR
   auth.jwt()->>'session_id' !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Synthetic owner session required' USING ERRCODE='42501';
 END IF;
 v_session:=(auth.jwt()->>'session_id')::uuid;
 IF NOT EXISTS(
  SELECT 1 FROM auth.users u
  WHERE u.id=v_owner
   AND u.raw_app_meta_data @> '{"all251_httpmatrix":true}'::jsonb
   AND u.email LIKE 'all251-http-%@example.invalid'
 ) OR NOT EXISTS(
  SELECT 1 FROM auth.sessions s
  WHERE s.id=v_session AND s.user_id=v_owner
   AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())
 ) THEN RAISE EXCEPTION 'Synthetic account session denied' USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||v_owner::text,0));
 IF NOT EXISTS(
  SELECT 1 FROM allin_private.v2_account_deletion_requests d
  WHERE d.user_id=v_owner AND d.status='requested'
 ) THEN RAISE EXCEPTION 'Synthetic deletion freeze required'
  USING ERRCODE='42501'; END IF;
 IF EXISTS(
  SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review l
  WHERE l.owner_id=v_owner AND l.settled_at IS NULL
 ) THEN RAISE EXCEPTION 'Unsettled lease blocks R2 fixture cleanup'
  USING ERRCODE='42501'; END IF;
 RETURN true;
END
$cleanup$;
REVOKE ALL ON FUNCTION
 public.v2_all251_owner_r2_fixture_cleanup_allowed_review()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.v2_all251_owner_r2_fixture_cleanup_allowed_review()
 TO authenticated;
