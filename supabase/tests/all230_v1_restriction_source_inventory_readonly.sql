-- ALL-230: read-only, privacy-preserving V1 restriction-source discovery.
-- Execute only against the independently identified V1 project. No athlete
-- rows, JSON values, owner IDs, credential data or row-level digests returned.
-- Counts are a same-statement observation, NOT an authenticated archive,
-- historical completeness proof, or first-certification authorization.
WITH scoped_tables AS (
 SELECT 'public.allin_training'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_training
 UNION ALL
 SELECT 'public.allin_training_plan_versions'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_training_plan_versions
 UNION ALL
 SELECT 'public.allin_training_sessions'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_training_sessions
 UNION ALL
 SELECT 'public.allin_workout_user_overrides'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_workout_user_overrides
 UNION ALL
 SELECT 'public.allin_workout_plan_links'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_workout_plan_links
 UNION ALL
 SELECT 'public.allin_coach_learnings'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_coach_learnings
 UNION ALL
 SELECT 'public.allin_coach_thread_facts'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_coach_thread_facts
 UNION ALL
 SELECT 'public.allin_coach_thread_state'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_coach_thread_state
 UNION ALL
 SELECT 'public.allin_coaching_records'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_coaching_records
 UNION ALL
 SELECT 'public.allin_workout_sync_sources'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_workout_sync_sources
 UNION ALL
 SELECT 'public.allin_backup_restore_drills'::text AS table_name, count(*)::bigint AS record_count FROM public.allin_backup_restore_drills
), training_signals AS (
 SELECT count(*)::bigint AS training_rows,
 count(*) FILTER (WHERE
   preferences->'limitation' IS NOT NULL AND
   preferences->'limitation'<>'null'::jsonb AND
   preferences->'limitation'<>'""'::jsonb AND
   preferences->'limitation'<>'[]'::jsonb AND
   preferences->'limitation'<>'{}'::jsonb
 )::bigint AS nonempty_limitation_rows,
 count(*) FILTER (WHERE jsonb_typeof(draft)='object')::bigint AS draft_object_rows,
 count(*) FILTER (WHERE accepted IS NOT NULL AND accepted<>'null'::jsonb)::bigint AS accepted_nonnull_rows
 FROM public.allin_training
)
SELECT jsonb_build_object(
 'observationType','v1_source_catalog_readonly',
 'observedUtc',pg_catalog.clock_timestamp(),
 'scopedTables',(
 SELECT jsonb_agg(jsonb_build_object('table',table_name,'rows',record_count)
 ORDER BY table_name) FROM scoped_tables),
 'trainingSignals',(SELECT pg_catalog.to_jsonb(s) FROM training_signals s),
 'fullHistoricalCoverageEstablished',false,
 'independentImportJobManifestVerified',false,
 'restrictionMappingAccepted',false,
 'initialCertificationAuthorized',false
) AS source_inventory_observation;
