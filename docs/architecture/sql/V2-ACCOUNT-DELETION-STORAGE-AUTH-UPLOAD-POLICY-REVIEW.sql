-- ALL-251 REVIEW ONLY: not a migration, not production write authorization.
-- Requires V2-ACCOUNT-DELETION-STORAGE-WRITE-GATE-REVIEW.sql.
-- Restrictive Storage RLS policy never grants upload by itself. Must have
-- a separate approved permissive owner policy before any uploads are allowed.
-- Service role and S3 privileged writers bypass RLS and remain UNACCEPTED.
CREATE FUNCTION public.v2_storage_owner_upload_gate_review(
 p_bucket_id text,p_object_path text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE v_owner uuid;
BEGIN
 v_owner:=auth.uid();
 IF v_owner IS NULL OR p_bucket_id<>'v2-private-workout-objects'
    OR p_object_path IS NULL OR length(p_object_path)>1024
    OR left(p_object_path,length(v_owner::text)+1)<>v_owner::text||'/'
    OR p_object_path ~ '[[:cntrl:]]'
    OR position('/../' IN '/'||p_object_path||'/')>0
    OR position('/./' IN '/'||p_object_path||'/')>0
 THEN RAISE EXCEPTION 'Unapproved owner Storage upload'
   USING ERRCODE='42501'; END IF;
 RETURN allin_private.v2_assert_owner_storage_write_allowed_review(v_owner);
END $guard$;
REVOKE ALL ON FUNCTION public.v2_storage_owner_upload_gate_review(text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_storage_owner_upload_gate_review(text,text)
 TO authenticated;
-- Runs inside the Storage metadata transaction: lock competes with the
-- existing deletion-request advisory lock. A standalone preflight would not.
CREATE POLICY v2_all251_auth_upload_insert_review
 ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.v2_storage_owner_upload_gate_review(bucket_id,name));
CREATE POLICY v2_all251_auth_upload_update_review
 ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (public.v2_storage_owner_upload_gate_review(bucket_id,name))
 WITH CHECK (public.v2_storage_owner_upload_gate_review(bucket_id,name));
