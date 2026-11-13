-- ALL-251 REVIEW CANDIDATE ONLY. Not an applied migration, not a live
-- Storage policy, and NOT authorization to arm account deletion.
-- Depends on canonical allin_private.v2_account_deletion_requests and auth.users.
-- All privileged uploads (including signed/S3/multipart paths) must be
-- disabled unless routed through the single trusted server writer.
--
-- Contract: a durable, non-expiring owner write lease begins under the SAME
-- advisory transaction lock as canonical deletion request creation. A
-- BEFORE INSERT/UPDATE trigger prevents requested/processing state while any
-- unresolved lease remains. A timed-out upload MUST NOT auto-release its
-- lease: a delayed Storage commit could otherwise recreate deleted bytes.
-- A separate operator reconciliation is needed for ambiguous writes.
CREATE TABLE allin_private.v2_privileged_storage_write_leases_review (
 lease_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 bucket_id text NOT NULL CHECK (bucket_id IN (
  'v2-private-workout-objects','v2-private-account-exports')),
 object_path text NOT NULL,
 operation text NOT NULL CHECK (operation IN ('create','replace')),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 CHECK (settled_at IS NULL OR settled_at>=created_at),
 CHECK (length(object_path) BETWEEN 1 AND 1024)
);
CREATE INDEX v2_priv_storage_lease_open_owner_review
 ON allin_private.v2_privileged_storage_write_leases_review(owner_id)
 WHERE settled_at IS NULL;
ALTER TABLE allin_private.v2_privileged_storage_write_leases_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_privileged_storage_write_leases_review
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.v2_begin_privileged_storage_write_review(
 p_owner_id uuid,p_bucket_id text,p_object_path text,p_operation text
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $begin$
DECLARE v_status text; v_id uuid;
BEGIN
 IF p_owner_id IS NULL OR p_bucket_id NOT IN (
  'v2-private-workout-objects','v2-private-account-exports')
  OR p_operation NOT IN ('create','replace')
  OR p_object_path IS NULL OR length(p_object_path)>1024
  OR left(p_object_path,length(p_owner_id::text)+1) IS DISTINCT FROM
    p_owner_id::text||'/'
  OR p_object_path ~ '[[:cntrl:]]'
  OR position('/../' IN '/'||p_object_path||'/')>0
  OR position('/./' IN '/'||p_object_path||'/')>0
 THEN RAISE EXCEPTION 'Invalid privileged Storage write scope' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id)
 OR NOT EXISTS(SELECT 1 FROM storage.buckets
   WHERE id=p_bucket_id AND public=false)
 THEN RAISE EXCEPTION 'Verified owner and private bucket required'
   USING ERRCODE='42501'; END IF;
 SELECT status INTO v_status FROM allin_private.v2_account_deletion_requests
 WHERE user_id=p_owner_id;
 IF v_status IN ('requested','processing','completed') THEN
  RAISE EXCEPTION 'Deletion request blocks privileged Storage writes'
   USING ERRCODE='42501'; END IF;
 INSERT INTO allin_private.v2_privileged_storage_write_leases_review
   (owner_id,bucket_id,object_path,operation)
 VALUES(p_owner_id,p_bucket_id,p_object_path,p_operation)
 RETURNING lease_id INTO v_id;
 RETURN v_id;
END $begin$;
REVOKE ALL ON FUNCTION public.v2_begin_privileged_storage_write_review(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_begin_privileged_storage_write_review(uuid,text,text,text)
 TO service_role;

-- Only the trusted server writer may settle after the Storage API has
-- responded conclusively AND a privileged byte download matches the payload.
-- Do not provide an automatic TTL/expiry or a client-callable release path.
CREATE FUNCTION public.v2_settle_privileged_storage_write_review(
 p_owner_id uuid,p_lease_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $settle$
DECLARE v_count integer;
BEGIN
 IF p_owner_id IS NULL OR p_lease_id IS NULL THEN
  RAISE EXCEPTION 'Exact privileged Storage lease scope required'
   USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 UPDATE allin_private.v2_privileged_storage_write_leases_review
 SET settled_at=now()
 WHERE owner_id=p_owner_id AND lease_id=p_lease_id AND settled_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN
  RAISE EXCEPTION 'Unknown or already settled Storage lease'
   USING ERRCODE='42501'; END IF;
 RETURN true;
END $settle$;
REVOKE ALL ON FUNCTION public.v2_settle_privileged_storage_write_review(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_settle_privileged_storage_write_review(uuid,uuid)
 TO service_role;

-- Protect every canonical deletion request, regardless of which application
-- path creates it. This trigger must be installed BEFORE enabling the writer.
CREATE FUNCTION allin_private.v2_deny_deletion_with_open_storage_leases_review()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF NEW.status IN ('requested','processing') THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:'||NEW.user_id::text,0));
  IF EXISTS(SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review
   WHERE owner_id=NEW.user_id AND settled_at IS NULL)
  THEN RAISE EXCEPTION 'Unresolved privileged Storage write blocks account deletion'
   USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION allin_private.v2_deny_deletion_with_open_storage_leases_review()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER v2_privileged_storage_write_fence_review
 BEFORE INSERT OR UPDATE ON allin_private.v2_account_deletion_requests
 FOR EACH ROW EXECUTE FUNCTION
 allin_private.v2_deny_deletion_with_open_storage_leases_review();
-- Review-only: callers with unrestricted service-role credentials can still
-- bypass this route through direct Storage API. Credential isolation and
-- removal of alternate privileged upload paths are release prerequisites.
