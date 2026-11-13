-- ALL-230 / ALL-12. Original V1 `impulecgsgaruvniuttc` only.
-- READ ONLY: no user data, Coach text, keys, provider tokens or private identifiers.
-- Counts/metadata cannot prove independent import job completeness or hosted restore.
WITH scoped(name) AS (
 SELECT unnest(ARRAY[
 'allin_backup_restore_drills','allin_coach_learnings',
 'allin_coach_thread_facts','allin_coach_thread_state',
 'allin_coaching_records','allin_training',
 'allin_training_plan_versions','allin_training_sessions',
 'allin_workout_plan_links','allin_workout_sync_sources',
 'allin_workout_user_overrides'
 ])
), foreign_keys AS (
 SELECT c.conrelid::regclass::text AS source_table,
 c.confrelid::regclass::text AS referenced_table,
 r.relname AS referenced_name
 FROM pg_constraint c
 JOIN pg_class t ON t.oid=c.conrelid
 JOIN pg_class r ON r.oid=c.confrelid
 JOIN scoped s ON s.name=t.relname
 WHERE c.contype='f'
)
SELECT jsonb_build_object(
 'observationType','v1_import_and_relational_inventory_readonly',
 'sourceProjectRef','impulecgsgaruvniuttc',
 'observedUtc',clock_timestamp(),
 'scopedTableCount',(SELECT count(*) FROM scoped),
 'scopedForeignKeyCount',(SELECT count(*) FROM foreign_keys),
 'externalForeignKeyCount',(SELECT count(*) FROM foreign_keys f
  WHERE NOT EXISTS(SELECT 1 FROM scoped s WHERE s.name=f.referenced_name)),
 'externalReferenceTables',(SELECT coalesce(jsonb_agg(DISTINCT referenced_table ORDER BY referenced_table),'[]'::jsonb)
  FROM foreign_keys f WHERE NOT EXISTS(SELECT 1 FROM scoped s WHERE s.name=f.referenced_name)),
 'authIdentityCount',(SELECT count(*) FROM auth.users),
 'profileGoalCount',(SELECT count(*) FROM public.allin_profile_goals),
 'namedImportRelatedSourceCounts',jsonb_build_object(
  'aiModelRouteHistory',(SELECT count(*) FROM public.allin_ai_model_route_history),
  'backupRestoreDrills',(SELECT count(*) FROM public.allin_backup_restore_drills),
  'integrationHealth',(SELECT count(*) FROM public.allin_integration_health),
  'raceProviderResults',(SELECT count(*) FROM public.allin_race_provider_results),
  'raceProviderMappings',(SELECT count(*) FROM public.allin_race_result_provider_mappings),
  'workoutSyncSources',(SELECT count(*) FROM public.allin_workout_sync_sources)
 ),
 'externalProviderInventoriesReviewed',false,
 'negativeImportJobProofEstablished',false,
 'fullHistoricalSourceCoverageEstablished',false,
 'foreignKeysRestoredAndValidated',false,
 'hostedSnapshotRestoreAccepted',false,
 'firstRestrictionCertificationAuthorized',false
) AS recovery_inventory;
