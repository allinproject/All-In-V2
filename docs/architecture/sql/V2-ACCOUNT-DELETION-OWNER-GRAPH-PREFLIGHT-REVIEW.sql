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
    'lower_user_id','upper_user_id','target_id','account_id','profile_id'
   ])
)
SELECT rc.schema_name,rc.table_name,rc.owner_column,
 CASE
  WHEN rc.schema_name='allin_private'
   AND rc.table_name='v2_account_deletion_execution_audit'
   THEN 'audit_retention_policy_required'
  WHEN rc.owner_column=ANY(ARRAY[
   'actor_id','follower_id','followed_id','blocker_id','blocked_id',
   'lower_user_id','upper_user_id','target_id'])
   THEN 'relationship_or_actor_retention_policy_required'
  ELSE 'no_verified_auth_cascade_path'
 END::text AS reason
FROM rel_columns rc
WHERE rc.owner_column=ANY(ARRAY[
  'actor_id','follower_id','followed_id','blocker_id','blocked_id',
   'lower_user_id','upper_user_id','target_id'])
 OR NOT EXISTS(SELECT 1 FROM cascade_reachable r WHERE r.relid=rc.relid)
UNION ALL
-- Join-only receipts/events may have no user_id or owner_id column of their
-- own: if they reference an athlete-owned V2 parent but are NOT reachable
-- through ON DELETE CASCADE from auth.users, Auth deletion could strand them.
-- Global ingredient/reference tables lacking such owner-parent links are
-- not classified as athlete data by this check.
SELECT n.nspname::text,c.relname::text,'foreign_key'::text,
 'join_only_owner_child_without_verified_auth_cascade'::text
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')
 AND c.relname LIKE 'v2_%'
 AND NOT EXISTS(SELECT 1 FROM cascade_reachable r WHERE r.relid=c.oid)
 AND NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_attribute self_owner
   WHERE self_owner.attrelid=c.oid AND self_owner.attnum>0
    AND NOT self_owner.attisdropped
    AND self_owner.attname=ANY(ARRAY[
      'user_id','owner_id','athlete_id','actor_id',
      'created_by_user_id','athlete_user_id','follower_id','followed_id',
      'blocker_id','blocked_id','lower_user_id','upper_user_id',
      'target_id','account_id','profile_id'
    ])
 )
 AND EXISTS(
   SELECT 1 FROM pg_catalog.pg_constraint link
   JOIN pg_catalog.pg_class parent ON parent.oid=link.confrelid
   JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
   JOIN pg_catalog.pg_attribute parent_owner
    ON parent_owner.attrelid=parent.oid AND parent_owner.attnum>0
     AND NOT parent_owner.attisdropped
   WHERE link.conrelid=c.oid AND link.contype='f'
    AND pn.nspname IN ('public','allin_private')
    AND parent.relname LIKE 'v2_%'
    AND parent_owner.attname=ANY(ARRAY[
      'user_id','owner_id','athlete_id','athlete_user_id','account_id'
    ])
 )
UNION ALL
-- A bucket can retain orphan private bytes even with perfect DB cascades.
-- No Storage cleanup has been accepted. A name here is a blocker, not a
-- permission to list or download its contents.
SELECT 'storage'::text,b.id::text,'objects'::text,
 'unreviewed_storage_bucket_cleanup'::text
FROM storage.buckets b
UNION ALL
-- A partially installed/broken shared staging barrier is never equivalent to
-- the original canonical foundation (which has no lease or three fences).
SELECT 'storage'::text,'v2_privileged_storage_write_leases_review'::text,
 'owner_id'::text,'missing_privileged_storage_lease_ledger_with_active_fences'::text
WHERE pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
 IS NULL
 AND (
 EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=pg_catalog.to_regclass('allin_private.v2_account_deletion_requests')
      AND t.tgname='v2_privileged_storage_write_fence_review'
      AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='auth.users'::pg_catalog.regclass
      AND t.tgname='v2_privileged_storage_auth_delete_fence_review'
      AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=pg_catalog.to_regclass('storage.objects')
      AND t.tgname='v2_privileged_storage_metadata_write_fence_review'
      AND t.tgenabled='O' AND NOT t.tgisinternal))
UNION ALL
-- The canonical privileged Storage lease ledger is the active upload fence.
-- A correct owner FK cannot replace this protection: without the following
-- live triggers, a claim, Auth cascade, or privileged metadata writer may
-- race and leave bytes behind. Never repair by dropping the lease ledger.
SELECT 'storage'::text,'v2_privileged_storage_write_leases_review'::text,
  'owner_id'::text,'missing_or_unsecured_privileged_write_lease_ledger'::text
WHERE pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
 IS NOT NULL
AND (
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid=pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
     AND c.relkind='r' AND c.relrowsecurity)
  OR pg_catalog.has_table_privilege('anon',
      'allin_private.v2_privileged_storage_write_leases_review','SELECT,INSERT,UPDATE,DELETE')
  OR pg_catalog.has_table_privilege('authenticated',
      'allin_private.v2_privileged_storage_write_leases_review','SELECT,INSERT,UPDATE,DELETE')
  OR pg_catalog.has_table_privilege('service_role',
      'allin_private.v2_privileged_storage_write_leases_review','SELECT,INSERT,UPDATE,DELETE')
  OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid
       AND a.attname='owner_id'
      WHERE k.conrelid=pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
       AND k.confrelid='auth.users'::pg_catalog.regclass
       AND k.contype='f' AND k.confdeltype='c'
       AND a.attnum=ANY(k.conkey))
)
UNION ALL
SELECT 'storage'::text,'v2_privileged_storage_write_leases_review'::text,
 'owner_id'::text,'missing_privileged_storage_deletion_or_auth_fence'::text
WHERE pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
 IS NOT NULL
AND (
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=pg_catalog.to_regclass('allin_private.v2_account_deletion_requests')
     AND t.tgname='v2_privileged_storage_write_fence_review'
     AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='auth.users'::pg_catalog.regclass
     AND t.tgname='v2_privileged_storage_auth_delete_fence_review'
     AND t.tgenabled='O' AND NOT t.tgisinternal)
)
UNION ALL
SELECT 'storage'::text,'objects'::text,
 'metadata'::text,'missing_privileged_storage_metadata_write_fence'::text
WHERE pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
 IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid=pg_catalog.to_regclass('storage.objects')
   AND t.tgname='v2_privileged_storage_metadata_write_fence_review'
   AND t.tgenabled='O' AND NOT t.tgisinternal)
ORDER BY 1,2,3;
$scanner$;
-- A future approved migration must review explicit grants and function owner.
REVOKE ALL ON FUNCTION allin_private.v2_deletion_owner_graph_gaps_review()
 FROM PUBLIC,anon,authenticated,service_role;
