-- ALL-251/222: NON-MUTATING shared staging account-lifecycle compatibility.
-- This reports exact release gaps, not an approval to activate or deploy.
WITH contract(name,installed,required_for) AS (
 VALUES
 ('canonical owner profiles',pg_catalog.to_regclass('public.v2_profiles') IS NOT NULL,'Training owner/session read'),
 ('canonical private health',pg_catalog.to_regclass('allin_private.v2_health_considerations') IS NOT NULL,'complete user-data accounting'),
 ('canonical deletion request owner',pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NOT NULL,'request state'),
 ('canonical deletion processor OFF switch',pg_catalog.to_regclass('allin_private.v2_account_deletion_processor_config') IS NOT NULL,'fail-closed processing'),
 ('canonical durable deletion audit',pg_catalog.to_regclass('allin_private.v2_account_deletion_execution_audit') IS NOT NULL,'recovery/accountability'),
 ('canonical owner deletion request RPC',pg_catalog.to_regprocedure('public.v2_request_account_deletion(uuid,text)') IS NOT NULL,'authenticated owner request'),
 ('canonical owner cancellation RPC',pg_catalog.to_regprocedure('public.v2_cancel_account_deletion_request(uuid,uuid)') IS NOT NULL,'owner cancellation'),
 ('canonical current-snapshot export RPC',pg_catalog.to_regprocedure('public.v2_export_my_account_snapshot(uuid)') IS NOT NULL,'baseline owner export integration'),
 ('staging session-bound export gate',pg_catalog.to_regprocedure('allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)') IS NOT NULL,'review-only export handoff'),
 ('staging Storage lease table',pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review') IS NOT NULL,'privileged upload barrier'),
 ('staging account deletion lease trigger',EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid=pg_catalog.to_regclass('allin_private.v2_account_deletion_requests')
   AND t.tgname='v2_privileged_storage_write_fence_review' AND t.tgenabled='O'),
  'deletion request/upload fencing'),
 ('staging Auth deletion lease trigger',EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='auth.users'::pg_catalog.regclass
   AND t.tgname='v2_privileged_storage_auth_delete_fence_review' AND t.tgenabled='O'),
  'Auth deletion/upload fencing'),
 ('staging export Auth session expiration',
  coalesce(position('not_after' IN pg_catalog.pg_get_functiondef(
   pg_catalog.to_regprocedure('allin_private.v2_account_export_authorize_session_candidate(uuid,uuid)')))>0,false),
  'expired token/session rejection'),
 ('canonical Training owner graph',pg_catalog.to_regclass('public.v2_training_plans') IS NOT NULL,'complete Training export/delete coverage'),
 ('canonical Completed Activity graph',pg_catalog.to_regclass('public.v2_completed_activities') IS NOT NULL,'complete Activity export/delete coverage')
)
SELECT name,installed,required_for,
 CASE WHEN installed THEN 'PRESENT, further functional acceptance required'
 ELSE 'MISSING — release gate remains closed' END AS result
FROM contract ORDER BY name;
