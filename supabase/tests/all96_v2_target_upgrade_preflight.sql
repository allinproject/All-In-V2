-- ALL-96: read-only hosted V2 target preflight. No migration, fixture, or user-row writes.
-- Run before proposing a representative populated upgrade; record project ref and Git SHA separately.
-- This deliberately reports ABSENT candidate domains rather than treating isolated CI as deployment.
WITH required_domains(domain,relation_name) AS (
 VALUES
 ('Training','public.v2_training_sessions'),
 ('Completed Activity','public.v2_completed_activities'),
 ('Activity sources','public.v2_activity_sources'),
 ('Coach','public.v2_coach_threads')
), domain_status AS (
 SELECT domain,relation_name,to_regclass(relation_name) IS NOT NULL AS installed
 FROM required_domains
), policy_status AS (
 SELECT count(*)::int AS exposed_tables_without_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
)
SELECT current_database() AS database_name,
 current_setting('server_version') AS postgres_version,
 (SELECT count(*) FROM supabase_migrations.schema_migrations) AS applied_migrations,
 (SELECT count(*) FROM auth.users) AS auth_users,
 (SELECT count(*) FROM public.v2_profiles) AS v2_profiles,
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')) AS app_tables,
 (SELECT exposed_tables_without_rls FROM policy_status) AS public_tables_without_rls,
 (SELECT jsonb_object_agg(domain,installed ORDER BY domain) FROM domain_status) AS domain_installed,
 (SELECT bool_and(installed) FROM domain_status) AS core_domains_installed,
 CASE WHEN (SELECT bool_and(installed) FROM domain_status)
  THEN 'REVIEW_PERMISSIONS_AND_FIXTURE_BEFORE_UPGRADE'
  ELSE 'BLOCK_HOSTED_APP_INTEGRATION_UNTIL_APPROVED_SCHEMA_UPGRADE'
 END AS upgrade_gate;
