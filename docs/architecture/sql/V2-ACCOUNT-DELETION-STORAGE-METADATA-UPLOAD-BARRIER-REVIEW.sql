-- ALL-251: STAGING-ONLY DEFENSE-IN-DEPTH REVIEW CANDIDATE.
-- This is NOT a replacement for provider credential isolation, and does not
-- prove signed/S3/multipart payload writes cannot occur outside Storage
-- metadata transactions. NEVER arm destructive account deletion from this.
-- Requires the previously installed canonical durable lease/claim guards.
--
-- Supabase Storage manages object bytes outside PostgreSQL. Do not directly
-- INSERT/UPDATE/DELETE storage.objects to perform a real Storage operation.
-- This trigger observes API-driven metadata writes and rejects those with no
-- matching durable canonical lease for our two private buckets.
CREATE FUNCTION allin_private.v2_deny_unleased_storage_object_write_review()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $metadata_fence$
DECLARE
 v_owner_text text;
 v_owner uuid;
 v_status text;
 v_open_count bigint;
BEGIN
 IF TG_OP='UPDATE'
    AND OLD.bucket_id IN ('v2-private-workout-objects','v2-private-account-exports')
    AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
      OR NEW.name IS DISTINCT FROM OLD.name)
 THEN
   RAISE EXCEPTION 'Moving a private object requires a separately reviewed writer'
     USING ERRCODE='42501';
 END IF;

 IF NEW.bucket_id NOT IN ('v2-private-workout-objects','v2-private-account-exports')
 THEN RETURN NEW; END IF;
 IF NEW.name IS NULL OR length(NEW.name)>1024
    OR NEW.name ~ '[[:cntrl:]]' OR NEW.name LIKE '%/../%'
    OR NEW.name LIKE '%/./%' THEN
   RAISE EXCEPTION 'Private Storage object path is not verified'
     USING ERRCODE='42501';
 END IF;

 v_owner_text:=pg_catalog.split_part(NEW.name,'/',1);
 IF v_owner_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR length(NEW.name)<=length(v_owner_text)+1 THEN
   RAISE EXCEPTION 'Private Storage owner path is not a verified UUID'
     USING ERRCODE='42501';
 END IF;
 v_owner:=v_owner_text::uuid;
 -- Same owner lock used by canonical lease begin, settlement, deletion request
 -- and direct Auth deletion. This closes a race at metadata COMMIT, not a
 -- provider-level guarantee about all object-byte upload protocols.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:'||v_owner::text,0));
 SELECT status INTO v_status
 FROM allin_private.v2_account_deletion_requests WHERE user_id=v_owner;
 IF v_status IN ('requested','processing','completed') OR
   NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_owner) THEN
   RAISE EXCEPTION 'Account deletion or absent owner blocks Storage write'
     USING ERRCODE='42501';
 END IF;
 SELECT pg_catalog.count(*) INTO v_open_count
 FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=v_owner AND bucket_id=NEW.bucket_id AND
   object_path=NEW.name AND settled_at IS NULL;
 IF v_open_count<>1 THEN
   RAISE EXCEPTION 'Exactly one active private Storage write lease required'
     USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $metadata_fence$;

REVOKE ALL ON FUNCTION
 allin_private.v2_deny_unleased_storage_object_write_review()
 FROM PUBLIC,anon,authenticated,service_role;

-- Storage API may update unrelated access timestamps on download; fence
-- content/name/version/metadata changes, not a read-only access timestamp.
CREATE TRIGGER v2_privileged_storage_metadata_write_fence_review
 BEFORE INSERT OR UPDATE OF bucket_id,name,version,metadata,user_metadata,owner_id
 ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION
 allin_private.v2_deny_unleased_storage_object_write_review();

-- This trigger alone does not protect S3 multipart bytes before completion,
-- raw provider credentials, metadata-independent writes or a compromised
-- service-role credential capable of acquiring/settling leases. They remain
-- separate ALL-251 security acceptance gates.
