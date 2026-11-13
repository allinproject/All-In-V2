-- ALL-222/243/246: READ-ONLY HOSTED STAGING PREREQUISITE INVENTORY
-- Safe against existing shared staging; never creates, modifies, or deletes data.
-- Release gate: all six required foundation objects must exist BEFORE
-- attempting the versioned Training/Completed Activity migration set.
WITH required(object_name,actual_oid) AS (
 VALUES
 ('canonical V2 profile',pg_catalog.to_regclass('public.v2_profiles')::oid),
 ('canonical account export',pg_catalog.to_regprocedure('public.v2_export_my_account_snapshot(uuid)')::oid),
 ('canonical deletion request',pg_catalog.to_regclass('allin_private.v2_account_deletion_requests')::oid),
 ('canonical Training planner',pg_catalog.to_regclass('public.v2_training_plans')::oid),
 ('canonical Completed Activity',pg_catalog.to_regclass('public.v2_completed_activities')::oid),
 ('canonical owner reader',pg_catalog.to_regprocedure('public.v2_training_day_read_candidate(uuid,date)')::oid)
)
SELECT object_name, actual_oid IS NOT NULL AS present,
 CASE
  WHEN object_name IN ('canonical V2 profile','canonical account export')
       AND actual_oid IS NULL THEN 'FOUNDATION MISSING: DO NOT DEPLOY PR #15'
  WHEN object_name IN ('canonical Training planner','canonical Completed Activity',
                       'canonical owner reader') AND actual_oid IS NOT NULL
       THEN 'ALREADY PRESENT: RECONCILE BEFORE DEPLOYING'
  WHEN object_name='canonical deletion request' AND actual_oid IS NOT NULL
       THEN 'ALREADY PRESENT: CHECK EXISTING ALL-251 OWNERSHIP/DDL BEFORE DEPLOY'
  ELSE 'review required' END AS gate
FROM required ORDER BY object_name;
