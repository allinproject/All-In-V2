-- ALL-230 / ALL-12: PRIVACY-SAFE source completeness reconnaissance ONLY.
-- Execute only against the original V1 project impulecgsgaruvniuttc.
-- Never return message text, owner IDs, athlete notes or JSON payloads.
-- A nonempty count or a regex hit is a review signal, NOT a restriction.
WITH catalog AS (
 SELECT n.nspname,c.relname,
  bool_or(a.atttypid IN ('json'::regtype,'jsonb'::regtype)) has_json
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND c.relname LIKE 'allin_%'
 GROUP BY n.nspname,c.relname
), training AS (
 SELECT count(*)::bigint total_rows,
 count(*) FILTER (WHERE jsonb_typeof(preferences->'limitation')='string'
   AND lower(btrim(preferences->>'limitation'))='none')::bigint none_sentinel_rows,
 count(*) FILTER (WHERE jsonb_typeof(preferences->'limitation')='string'
   AND length(btrim(preferences->>'limitation'))>0
   AND lower(btrim(preferences->>'limitation'))<>'none')::bigint other_text_limitation_rows
 FROM public.allin_training
), messages AS (
 SELECT count(*)::bigint total_rows,
 count(*) FILTER (WHERE content ~* '(injur|pain|limitation|restrict|avoid|can.t do|cannot do|unable to|medical|rehab|recover|contraindicat)')::bigint possible_restriction_mentions
 FROM public.allin_coach_messages
)
SELECT jsonb_build_object(
 'observationType','v1_extended_restriction_source_inventory_readonly',
 'observedUtc',clock_timestamp(),
 'v1ProjectRef','impulecgsgaruvniuttc',
 'allinTableCount',(SELECT count(*) FROM catalog),
 'jsonBearingAllinTableCount',(SELECT count(*) FROM catalog WHERE has_json),
 'trainingSignals',(SELECT to_jsonb(t) FROM training t),
 'coachMessageSignals',(SELECT to_jsonb(m) FROM messages m),
 'reviewedCoachMessages',false,
 'reviewedAllPotentialLegacySources',false,
 'externalImportJobHistoryVerified',false,
 'historicalSourceCompletenessEstablished',false,
 'initialCertificationAuthorized',false
) AS source_scope_observation;
