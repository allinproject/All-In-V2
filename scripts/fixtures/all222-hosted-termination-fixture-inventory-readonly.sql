-- ALL-222: READ-ONLY operator review of synthetic active-TUS fixtures.
-- Pinned disposable staging ONLY: fbtgknlxjyeqrxemskbl.
-- Do not run against production; do not copy fixture IDs into support logs.
-- This query DOES NOT terminate provider sessions or authorize cleanup.
-- The provider's absent HEAD/PATCH and absent bytes MUST be separately
-- proven before any explicitly approved reconciliation of cancelled leases.
WITH tagged_owners AS (
 SELECT u.id, u.email
 FROM auth.users AS u
 WHERE u.raw_app_meta_data ->> 'all222_disposable' = 'true'
   AND u.raw_app_meta_data ->> 'all222_fixture' = 'terminate-active'
   AND u.email ~ '^all222-terminate-active-[0-9a-f-]+@example[.]invalid$'
),
review AS (
 SELECT u.id AS synthetic_owner_id,
   count(l.lease_id)::integer AS leases_total,
   count(l.lease_id) FILTER (WHERE l.settled_at IS NULL AND l.cancelled_at IS NULL)::integer AS unresolved_leases,
   count(l.lease_id) FILTER (WHERE l.settled_at IS NULL AND l.cancelled_at IS NOT NULL)::integer AS cancelled_unsettled_leases,
   count(l.lease_id) FILTER (WHERE l.settled_at IS NOT NULL)::integer AS settled_leases,
   count(l.lease_id) FILTER (WHERE l.bucket_id <> 'v2-private-workout-objects'
     OR l.operation <> 'create'
     OR l.object_path NOT LIKE u.id::text || '/all222-positive-%-terminate-active.bin')::integer AS out_of_scope_leases
 FROM tagged_owners u
 LEFT JOIN allin_private.v2_privileged_storage_write_leases_review l ON l.owner_id = u.id
 GROUP BY u.id
)
SELECT r.synthetic_owner_id,r.leases_total,r.unresolved_leases,
 r.cancelled_unsettled_leases,r.settled_leases,r.out_of_scope_leases,
 EXISTS(
   SELECT 1 FROM storage.objects o
   WHERE o.bucket_id='v2-private-workout-objects'
     AND o.name LIKE r.synthetic_owner_id::text || '/%'
 ) AS any_owner_workout_object,
 EXISTS(
   SELECT 1 FROM allin_private.v2_account_deletion_requests d
   WHERE d.user_id=r.synthetic_owner_id
 ) AS any_account_deletion_record
FROM review r
ORDER BY r.synthetic_owner_id;
