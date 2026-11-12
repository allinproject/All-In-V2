-- ALL-243 REVIEW ONLY. Not a migration and NOT authorization to deploy.
-- Dedicated trusted server connection for the existing canonical ingest role.
-- Never grant operator membership or DB credentials to client/api roles.
-- Password is NOT provisioned by this file. Apply only after security review.
CREATE ROLE allin_v2_ingest_operator LOGIN NOINHERIT NOBYPASSRLS;
GRANT allin_v2_device_ingest TO allin_v2_ingest_operator
 WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT USAGE ON SCHEMA public,auth,allin_private TO allin_v2_ingest_operator;
GRANT SELECT(id) ON auth.users TO allin_v2_ingest_operator;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO allin_v2_ingest_operator;
GRANT SELECT ON public.v2_completed_activities,
 public.v2_activity_sources TO allin_v2_ingest_operator;
GRANT SELECT ON allin_private.v2_device_registrations_candidate
 TO allin_v2_ingest_operator;
GRANT INSERT ON allin_private.v2_device_ingest_nonce_candidate
 TO allin_v2_ingest_operator;
-- Operator's activity/source reads have the SAME owner-scoped RLS predicate
-- as the restricted device writer; no global athlete data reader.
CREATE POLICY v2_ingest_operator_activity_owner_candidate
 ON public.v2_completed_activities FOR SELECT TO allin_v2_ingest_operator
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY v2_ingest_operator_source_owner_candidate
 ON public.v2_activity_sources FOR SELECT TO allin_v2_ingest_operator
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY v2_ingest_operator_registry_owner_candidate
 ON allin_private.v2_device_registrations_candidate
 FOR SELECT TO allin_v2_ingest_operator
 USING (user_id=(SELECT auth.uid()));
CREATE POLICY v2_ingest_operator_nonce_insert_candidate
 ON allin_private.v2_device_ingest_nonce_candidate
 FOR INSERT TO allin_v2_ingest_operator
 WITH CHECK(owner_id=(SELECT auth.uid()));
GRANT EXECUTE ON FUNCTION auth.uid() TO allin_v2_ingest_operator;
-- Trust boundary: server authenticates bearer via Auth.getUser, then uses
-- a DEDICATED credential to establish request.jwt.claim.sub locally.
-- SQL GUC never constitutes independently verified authentication.
-- The operator is intentionally unable to register/revoke devices,
-- update activity/source, update/delete nonce or read metrics directly.
