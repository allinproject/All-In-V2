-- ALL-251 REVIEW ONLY: candidate per-object Storage cleanup checkpoints.
-- Run within BEGIN/ROLLBACK in disposable Postgres ONLY.
-- Requires existing allin_private.v2_account_deletion_execution_audit.
-- NOT a migration; NOT permission to enable deletion.
-- The durable canonical execution audit owns the request identity.
CREATE TABLE allin_private.v2_account_deletion_storage_checkpoint_review (
 request_id uuid not null references allin_private.v2_account_deletion_execution_audit(request_id) on delete cascade,
 bucket_id text not null,
 object_path text not null,
 status text not null default 'absent_verified'
   check (status='absent_verified'),
 verified_at timestamptz not null default now(),
 primary key(request_id,bucket_id,object_path),
 constraint v2_deletion_storage_review_bucket
   check (bucket_id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
 constraint v2_deletion_storage_review_path
   check (length(object_path) between 1 and 1024
      and position(chr(0) in object_path)=0)
);
ALTER TABLE allin_private.v2_account_deletion_storage_checkpoint_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_deletion_storage_checkpoint_review
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_account_deletion_storage_checkpoint_review IS
 'REVIEW ONLY. During processing stores object paths as sensitive evidence, never client-visible. Must be deleted/anonymized before deletion completion per approved retention policy.';

-- Only the already-claimed request in the canonical audit can record a
-- checkpoint. The server must verify real Storage absence independently.
CREATE FUNCTION allin_private.v2_deletion_checkpoint_absence_review(
 p_owner_id uuid,p_request_id uuid,p_bucket_id text,p_path text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF p_owner_id IS NULL OR p_request_id IS NULL
  OR p_bucket_id !~ '^[a-z0-9][a-z0-9-]{1,80}$'
  OR p_path IS NULL OR length(p_path)>1024 OR
     left(p_path,length(p_owner_id::text)+1)<>p_owner_id::text||'/'
  OR position('/../' in '/'||p_path||'/')>0
  OR position('/./' in '/'||p_path||'/')>0
 THEN RAISE EXCEPTION 'Invalid scoped Storage deletion checkpoint' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM allin_private.v2_account_deletion_execution_audit
  WHERE request_id=p_request_id AND user_id=p_owner_id
   AND status IN ('processing','failed') AND completed_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Exact active deletion execution required' USING ERRCODE='42501';
 END IF;
 INSERT INTO allin_private.v2_account_deletion_storage_checkpoint_review
  (request_id,bucket_id,object_path)
 VALUES(p_request_id,p_bucket_id,p_path)
 ON CONFLICT(request_id,bucket_id,object_path)
 DO UPDATE SET verified_at=now();
END $fn$;
REVOKE ALL ON FUNCTION allin_private.v2_deletion_checkpoint_absence_review(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
-- Deliberately NO EXECUTE grant. Future approved worker wrapper must authorize
-- server calls and recheck Storage absence; this is not usable via API.
