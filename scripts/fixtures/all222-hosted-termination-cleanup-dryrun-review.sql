-- ALL-222 — REVIEW-ONLY disposable staging fixture reconciliation.
-- NEVER run against production. Do NOT alter generic Auth/deletion guards.
-- This file is deliberately NON-MUTATING by default: placeholders cause
-- denial and the transaction ALWAYS ROLLS BACK.
-- External prerequisite not provable in SQL: operator independently
-- confirmed exact provider TUS DELETE 204; subsequent HEAD/PATCH 404 or
-- 410 (no offset); object GET/info NoSuchKey; physical byte absence.
-- Do not set any real IDs or change ROLLBACK to COMMIT without separate
-- explicit authorization and independent evidence review.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL all222.cleanup_owner_id = '00000000-0000-0000-0000-000000000000';
SET LOCAL all222.cleanup_lease_id = '00000000-0000-0000-0000-000000000000';
DO $all222$
DECLARE
 v_owner uuid := nullif(pg_catalog.current_setting('all222.cleanup_owner_id',true),'')::uuid;
 v_lease uuid := nullif(pg_catalog.current_setting('all222.cleanup_lease_id',true),'')::uuid;
 v_row record;
 v_removed integer;
BEGIN
 IF v_owner IS NULL OR v_lease IS NULL OR
    v_owner='00000000-0000-0000-0000-000000000000'::uuid OR
    v_lease='00000000-0000-0000-0000-000000000000'::uuid
 THEN RAISE EXCEPTION 'Exact approved fixture owner and lease required'
   USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:' || v_owner::text,0));
 IF NOT EXISTS(
   SELECT 1 FROM auth.users u
   WHERE u.id=v_owner
     AND u.raw_app_meta_data ->> 'all222_disposable'='true'
     AND u.raw_app_meta_data ->> 'all222_fixture'='terminate-active'
     AND u.email ~ '^all222-terminate-active-[0-9a-f-]+@example[.]invalid$'
 ) THEN RAISE EXCEPTION 'Non-synthetic owner must never be reconciled'
   USING ERRCODE='42501'; END IF;
 SELECT owner_id,bucket_id,object_path,operation,writer_sha256_review,
        settled_at,cancelled_at
 INTO v_row
 FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=v_owner AND lease_id=v_lease FOR UPDATE;
 IF NOT FOUND OR v_row.bucket_id<>'v2-private-workout-objects'
    OR v_row.operation<>'create'
    OR v_row.object_path NOT LIKE v_owner::text || '/all222-positive-%-terminate-active.bin'
    OR v_row.writer_sha256_review IS NULL
    OR v_row.writer_sha256_review !~ '^[0-9a-f]{64}$'
    OR v_row.settled_at IS NOT NULL OR v_row.cancelled_at IS NULL
 THEN RAISE EXCEPTION 'Exact cancelled attested synthetic lease required'
   USING ERRCODE='42501'; END IF;
 IF EXISTS(
   SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review l
   WHERE l.owner_id=v_owner AND l.lease_id<>v_lease
 ) THEN RAISE EXCEPTION 'Additional leases exist: reconciliation denied'
   USING ERRCODE='42501'; END IF;
 IF EXISTS(
   SELECT 1 FROM storage.objects o
   WHERE o.name LIKE v_owner::text || '/%'
     AND o.bucket_id IN ('v2-private-workout-objects','v2-private-account-exports')
 ) THEN RAISE EXCEPTION 'Private Storage objects remain: reconciliation denied'
   USING ERRCODE='42501'; END IF;
 IF EXISTS(
   SELECT 1 FROM allin_private.v2_account_deletion_requests d
   WHERE d.user_id=v_owner
 ) THEN RAISE EXCEPTION 'Account deletion request present: reconciliation denied'
   USING ERRCODE='42501'; END IF;
 -- This mutation is contained in a transaction that unconditionally
 -- ROLLS BACK. It is not an accepted or deployed cleanup operation.
 DELETE FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE owner_id=v_owner AND lease_id=v_lease
   AND settled_at IS NULL AND cancelled_at IS NOT NULL;
 GET DIAGNOSTICS v_removed=ROW_COUNT;
 IF v_removed<>1 THEN RAISE EXCEPTION 'Lease reconciliation count mismatch'
   USING ERRCODE='42501'; END IF;
 RAISE NOTICE 'REVIEW ONLY: exactly one synthetic cancelled lease would qualify; no commit';
END;
$all222$;
ROLLBACK;
