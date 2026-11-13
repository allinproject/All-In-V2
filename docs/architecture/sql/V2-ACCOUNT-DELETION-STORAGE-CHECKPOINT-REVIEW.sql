-- ALL-251 REVIEW ONLY: candidate per-object Storage cleanup checkpoints.
-- Run within BEGIN/ROLLBACK in disposable Postgres ONLY.
-- Requires existing allin_private.v2_account_deletion_execution_audit.
-- NOT a migration; NOT permission to enable deletion.
-- The durable canonical execution audit owns the request identity.

-- Review-only immutable per-bucket manifest, including empty buckets.
CREATE TABLE allin_private.v2_account_deletion_storage_plan_review (
 request_id uuid not null references allin_private.v2_account_deletion_execution_audit(request_id) on delete cascade,
 bucket_id text not null check(bucket_id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
 planned_paths text[] not null check(cardinality(planned_paths)<=10000),
 created_at timestamptz not null default now(),
 primary key(request_id,bucket_id)
);
ALTER TABLE allin_private.v2_account_deletion_storage_plan_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_deletion_storage_plan_review
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_account_deletion_storage_plan_review IS
 'REVIEW ONLY: Private planned object paths subject to approved deletion retention policy.';


CREATE FUNCTION allin_private.v2_deletion_storage_plan_review(
 p_owner_id uuid,p_request_id uuid,p_bucket_id text,p_observed_paths text[]
) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $plan$
DECLARE existing_paths text[]; proposed_paths text[]; v_path text;
BEGIN
 IF p_owner_id IS NULL OR p_request_id IS NULL OR p_bucket_id IS NULL
  OR p_bucket_id !~ '^[a-z0-9][a-z0-9-]{1,80}$'
  OR p_observed_paths IS NULL OR cardinality(p_observed_paths)>10000
 THEN RAISE EXCEPTION 'Invalid Storage plan scope' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_observed_paths) AS x(path)
   WHERE path IS NULL OR length(path)>1024 OR path ~ '[[:cntrl:]]'
     OR left(path,length(p_owner_id::text)+1)<>p_owner_id::text||'/'
     OR position('/../' IN '/'||path||'/')>0
     OR position('/./' IN '/'||path||'/')>0)
 OR (SELECT count(*) FROM unnest(p_observed_paths) AS x(path))
  <> (SELECT count(DISTINCT path) FROM unnest(p_observed_paths) AS x(path))
 THEN RAISE EXCEPTION 'Invalid or duplicate Storage path' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:'||p_owner_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM allin_private.v2_account_deletion_execution_audit
  WHERE request_id=p_request_id AND user_id=p_owner_id
   AND status IN ('processing','failed') AND completed_at IS NULL)
 THEN RAISE EXCEPTION 'Active deletion execution required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(x ORDER BY x),ARRAY[]::text[])
 INTO proposed_paths FROM unnest(p_observed_paths) AS x;
 INSERT INTO allin_private.v2_account_deletion_storage_plan_review
   (request_id,bucket_id,planned_paths)
 VALUES(p_request_id,p_bucket_id,proposed_paths)
 ON CONFLICT(request_id,bucket_id) DO NOTHING;
 SELECT planned_paths INTO existing_paths
 FROM allin_private.v2_account_deletion_storage_plan_review
 WHERE request_id=p_request_id AND bucket_id=p_bucket_id FOR UPDATE;
 FOREACH v_path IN ARRAY proposed_paths LOOP
  IF NOT v_path=ANY(existing_paths) THEN
   RAISE EXCEPTION 'Unplanned object found after Storage manifest closed'
    USING ERRCODE='42501';
  END IF;
 END LOOP;
 RETURN existing_paths;
END $plan$;
REVOKE ALL ON FUNCTION allin_private.v2_deletion_storage_plan_review(uuid,uuid,text,text[])
 FROM PUBLIC,anon,authenticated,service_role;

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
      and object_path !~ '[[:cntrl:]]')
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
 IF NOT EXISTS (
  SELECT 1 FROM allin_private.v2_account_deletion_storage_plan_review
  WHERE request_id=p_request_id AND bucket_id=p_bucket_id
    AND p_path=ANY(planned_paths)
 ) THEN RAISE EXCEPTION 'Checkpoint path not in immutable Storage plan'
  USING ERRCODE='42501'; END IF;
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

