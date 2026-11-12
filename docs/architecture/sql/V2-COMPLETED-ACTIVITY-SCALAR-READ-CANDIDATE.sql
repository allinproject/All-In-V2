-- ALL-243 REVIEW ONLY: conservative read projection of scalar evidence.
-- NOT A MIGRATION. Not a public RPC and does not certify competition power.
-- No guessing, no source priority, no fabricated zero, no client grants.
-- The production owner read must verify auth.uid/session and privacy BEFORE
-- invoking any service-owned reader with an owner ID.
CREATE FUNCTION allin_private.v2_activity_scalar_evidence_projection_candidate(
 p_user_id uuid,p_activity_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $project$
DECLARE
 v_activity public.v2_completed_activities%ROWTYPE;
 v_values jsonb;
 v_conflicts jsonb;
BEGIN
 IF p_user_id IS NULL OR p_activity_id IS NULL THEN
   RAISE EXCEPTION 'Owner and activity required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_activity FROM public.v2_completed_activities
  WHERE id=p_activity_id AND user_id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner-scoped activity not found'
   USING ERRCODE='42501'; END IF;
 -- Evidence from all sources, including excluded/low confidence sources,
 -- is considered when determining whether a metric can be displayed.
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,d.canonical_unit,
   m.value_numeric,m.value_text,m.value_boolean,m.measurement_kind,
   CASE
      WHEN m.quality IN ('trusted','partial') AND s.quality IN ('trusted','partial')
       THEN CASE WHEN m.quality='partial' OR s.quality='partial'
                 THEN 'partial' ELSE 'trusted' END
      ELSE 'unverified'
    END AS quality,
   m.source_id
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
    ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
   ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.activity_id=p_activity_id AND m.user_id=p_user_id
    AND m.segment_id IS NULL
    AND d.status='published' AND v_activity.sport=ANY(d.sport_scope)
 ), grouped AS (
  SELECT metric_code,definition_version,canonical_unit,
   COUNT(*) AS evidence_count,
   COUNT(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS low_confidence_count,
   COUNT(DISTINCT pg_catalog.jsonb_build_array(
      value_numeric,value_text,value_boolean,measurement_kind)) AS distinct_fact_count,
   MIN(quality) AS evidence_quality
  FROM rows GROUP BY metric_code,definition_version,canonical_unit
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'metricCode',g.metric_code,'definitionVersion',g.definition_version,
   'canonicalUnit',g.canonical_unit,'quality',
      CASE WHEN EXISTS(SELECT 1 FROM rows r
        WHERE r.metric_code=g.metric_code
          AND r.definition_version=g.definition_version
          AND r.quality='partial') THEN 'partial' ELSE 'trusted' END,
   'sourceCount',g.evidence_count,
   'valueNumeric',(SELECT r.value_numeric FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'valueText',(SELECT r.value_text FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'valueBoolean',(SELECT r.value_boolean FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'measurementKind',(SELECT r.measurement_kind FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1)
 ) ORDER BY g.metric_code,g.definition_version),'[]'::jsonb)
 INTO v_values FROM grouped g
 WHERE g.low_confidence_count=0 AND g.distinct_fact_count=1
   -- Two published versions for the same semantic code are not one
   -- reconciled canonical metric, even if their recorded numbers agree.
   AND (SELECT count(DISTINCT r.definition_version) FROM rows r
        WHERE r.metric_code=g.metric_code)=1;
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,
   CASE
      WHEN m.quality IN ('trusted','partial') AND s.quality IN ('trusted','partial')
       THEN CASE WHEN m.quality='partial' OR s.quality='partial'
                 THEN 'partial' ELSE 'trusted' END
      ELSE 'unverified'
    END AS quality,
   m.value_numeric,m.value_text,m.value_boolean,m.measurement_kind
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
   ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
   ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.activity_id=p_activity_id AND m.user_id=p_user_id
    AND m.segment_id IS NULL
   AND d.status='published' AND v_activity.sport=ANY(d.sport_scope)
 ), grouped AS (
  SELECT metric_code,MIN(definition_version) AS definition_version,
   COUNT(DISTINCT definition_version) AS version_count,
   COUNT(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS low_confidence,
   COUNT(DISTINCT pg_catalog.jsonb_build_array(
      value_numeric,value_text,value_boolean,measurement_kind)) AS fact_count
  FROM rows GROUP BY metric_code
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'metricCode',metric_code,
    'definitionVersion',CASE WHEN version_count=1 THEN definition_version ELSE NULL END,
    'reason',CASE WHEN version_count>1 THEN 'conflicting_versions'
                  WHEN low_confidence>0 THEN 'source_review_required'
                  ELSE 'conflicting_sources' END
 ) ORDER BY metric_code,definition_version),'[]'::jsonb)
 INTO v_conflicts FROM grouped
 WHERE version_count>1 OR low_confidence>0 OR fact_count<>1;
 RETURN pg_catalog.jsonb_build_object(
  'activityId',p_activity_id,'metrics',v_values,'unresolvedMetrics',v_conflicts,
  'coverage','source_backed_partial_registry');
END;
$project$;
REVOKE ALL ON FUNCTION
 allin_private.v2_activity_scalar_evidence_projection_candidate(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
