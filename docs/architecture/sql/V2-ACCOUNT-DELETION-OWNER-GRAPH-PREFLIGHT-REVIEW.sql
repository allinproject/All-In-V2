-- ALL-251 REVIEW-ONLY deletion owner-graph coverage scanner.
-- Disposable PostgreSQL / explicit reviewer only. NOT a migration, RPC,
-- release preflight replacement, retention policy, or destructive worker.
-- A path through cascading foreign keys proves relational cascade only,
-- never Storage deletion, third-party visibility or legal retention.
CREATE OR REPLACE FUNCTION allin_private.v2_deletion_owner_graph_gaps_review()
RETURNS TABLE(schema_name text,table_name text,owner_column text,reason text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $scanner$
WITH RECURSIVE cascade_reachable(relid,depth,path) AS (
 SELECT 'auth.users'::regclass::oid,0,ARRAY['auth.users'::regclass::oid]
 UNION ALL
 SELECT f.conrelid,r.depth+1,r.path||f.conrelid
 FROM cascade_reachable r
 JOIN pg_catalog.pg_constraint f ON f.confrelid=r.relid
  AND f.contype='f' AND f.confdeltype='c'
 WHERE r.depth<20 AND NOT f.conrelid=ANY(r.path)
), rel_columns AS (
 SELECT n.nspname::text AS schema_name,c.relname::text AS table_name,
 a.attname::text AS owner_column,c.oid AS relid
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname IN ('public','allin_private')
   AND c.relkind IN ('r','p') AND c.relname LIKE 'v2_%'
   AND a.attnum>0 AND NOT a.attisdropped
   AND a.attname=ANY(ARRAY[
    'user_id','owner_id','athlete_id','actor_id','created_by_user_id',
    'athlete_user_id','follower_id','followed_id','blocker_id','blocked_id',
    'account_id','profile_id'
   ])
)
SELECT rc.schema_name,rc.table_name,rc.owner_column,
 CASE
  WHEN rc.schema_name='allin_private'
   AND rc.table_name='v2_account_deletion_execution_audit'
   THEN 'audit_retention_policy_required'
  WHEN rc.owner_column=ANY(ARRAY[
   'actor_id','follower_id','followed_id','blocker_id','blocked_id'])
   THEN 'relationship_or_actor_retention_policy_required'
  ELSE 'no_verified_auth_cascade_path'
 END::text AS reason
FROM rel_columns rc
WHERE rc.owner_column=ANY(ARRAY[
  'actor_id','follower_id','followed_id','blocker_id','blocked_id'])
 OR NOT EXISTS(SELECT 1 FROM cascade_reachable r WHERE r.relid=rc.relid)
UNION ALL
-- A bucket can retain orphan private bytes even with perfect DB cascades.
-- No Storage cleanup has been accepted. A name here is a blocker, not a
-- permission to list or download its contents.
SELECT 'storage'::text,b.id::text,'objects'::text,
 'unreviewed_storage_bucket_cleanup'::text
FROM storage.buckets b
ORDER BY 1,2,3;
$scanner$;
-- A future approved migration must review explicit grants and function owner.
REVOKE ALL ON FUNCTION allin_private.v2_deletion_owner_graph_gaps_review()
 FROM PUBLIC,anon,authenticated,service_role;
