-- ALL-251 ISOLATED REVIEW ONLY. Must be loaded AFTER
-- V2-ACCOUNT-DELETION-STORAGE-CHECKPOINT-REVIEW.sql.
-- NOT a migration. No production deploy, worker enablement or Auth deletion.
-- This is the same service-role RPC name used by the staged operational worker.
--
-- This candidate can PROVE exact owner/request, bucket catalog coverage and
-- persisted checkpoint completeness from PostgreSQL. It CANNOT prove that
-- Storage API bytes have been removed, or that every authenticated/privileged
-- upload path is blocked. Those two fields intentionally remain FALSE.
-- Future acceptance must extend the owning policy/worker system with durable,
-- independently verified API absence and write-barrier evidence; never set
-- the fields to TRUE merely because a caller presents a flag/receipt.
CREATE FUNCTION public.v2_verify_account_deletion_storage_readiness(
 p_expected_user_id uuid, p_expected_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $all251_readiness$
DECLARE
 v_catalog_count integer;
 v_plan_count integer;
 v_checkpoints_complete boolean := false;
BEGIN
 IF p_expected_user_id IS NULL OR p_expected_request_id IS NULL THEN
  RAISE EXCEPTION 'Exact deletion Storage scope required' USING ERRCODE='22023';
 END IF;
 -- The canonical request and execution audit must both still refer to the
 -- same active, already-claimed owner/request. A stale/reused ID is rejected.
 IF NOT EXISTS (
  SELECT 1 FROM allin_private.v2_account_deletion_requests r
  JOIN allin_private.v2_account_deletion_execution_audit a
    ON a.request_id=r.request_id AND a.user_id=r.user_id
  WHERE r.user_id=p_expected_user_id AND r.request_id=p_expected_request_id
   AND r.status='processing' AND a.status='processing'
   AND a.completed_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Exact active deletion claim required' USING ERRCODE='42501';
 END IF;

 SELECT count(*) INTO v_catalog_count FROM storage.buckets;
 SELECT count(*) INTO v_plan_count
 FROM allin_private.v2_account_deletion_storage_plan_review p
 WHERE p.request_id=p_expected_request_id;

 -- Zero buckets is NOT acceptance. All currently registered buckets must
 -- have been independently reviewed as private and immutably inventoried.
 IF v_catalog_count > 0 AND v_catalog_count=v_plan_count
    AND NOT EXISTS(SELECT 1 FROM storage.buckets b WHERE b.public IS DISTINCT FROM false)
    AND NOT EXISTS(
     SELECT 1 FROM storage.buckets b
     WHERE NOT EXISTS (
      SELECT 1 FROM allin_private.v2_account_deletion_storage_plan_review p
       WHERE p.request_id=p_expected_request_id AND p.bucket_id=b.id
     )
    )
    AND NOT EXISTS(
     SELECT 1 FROM allin_private.v2_account_deletion_storage_plan_review p
     WHERE p.request_id=p_expected_request_id
      AND NOT EXISTS(SELECT 1 FROM storage.buckets b WHERE b.id=p.bucket_id)
    )
    -- Even if a privileged import bypasses the planning RPC, invalid,
    -- duplicated, or foreign paths must fail aggregate completeness.
    AND NOT EXISTS(
     SELECT 1 FROM allin_private.v2_account_deletion_storage_plan_review p
     WHERE p.request_id=p_expected_request_id AND (
      p.planned_paths IS NULL
      OR cardinality(p.planned_paths)>10000
      OR (SELECT count(DISTINCT x.path) FROM unnest(p.planned_paths) AS x(path))
          IS DISTINCT FROM cardinality(p.planned_paths)
      OR EXISTS(
       SELECT 1 FROM unnest(p.planned_paths) AS x(path)
       WHERE x.path IS NULL OR length(x.path)>1024
         OR left(x.path,length(p_expected_user_id::text)+1)
            IS DISTINCT FROM p_expected_user_id::text||'/'
         OR x.path ~ '[[:cntrl:]]'
         OR position('/../' IN '/'||x.path||'/')>0
         OR position('/./' IN '/'||x.path||'/')>0
      )
     )
    )
    -- A rogue checkpoint (or checkpoint in another bucket) must never make
    -- missing planned-object evidence appear complete.
    AND NOT EXISTS(
     SELECT 1 FROM allin_private.v2_account_deletion_storage_checkpoint_review c
     WHERE c.request_id=p_expected_request_id AND NOT EXISTS (
      SELECT 1 FROM allin_private.v2_account_deletion_storage_plan_review p
      WHERE p.request_id=c.request_id AND p.bucket_id=c.bucket_id
       AND c.object_path=ANY(p.planned_paths)
     )
    )
    AND NOT EXISTS(
     SELECT 1 FROM allin_private.v2_account_deletion_storage_plan_review p
     CROSS JOIN LATERAL unnest(p.planned_paths) AS path(value)
     WHERE p.request_id=p_expected_request_id
       AND NOT EXISTS (
        SELECT 1 FROM allin_private.v2_account_deletion_storage_checkpoint_review c
        WHERE c.request_id=p.request_id AND c.bucket_id=p.bucket_id
         AND c.object_path=path.value AND c.status='absent_verified'
       )
    )
 THEN v_checkpoints_complete := true;
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_expected_user_id,
  'requestId',p_expected_request_id,
  'durableCheckpointVerified',v_checkpoints_complete,
  'completePrivateStorage',false,
  'uploadBarrierEnforced',false
 );
END $all251_readiness$;
REVOKE ALL ON FUNCTION public.v2_verify_account_deletion_storage_readiness(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_verify_account_deletion_storage_readiness(uuid,uuid)
 TO service_role;
COMMENT ON FUNCTION public.v2_verify_account_deletion_storage_readiness(uuid,uuid) IS
 'ALL-251 review-only aggregate PostgreSQL checkpoint and catalog proof; always refuses operational Storage/Barrier acceptance until independently certified.';
