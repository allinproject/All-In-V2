-- ALL-243 REVIEW ONLY: evidence-aware scalar metrics for ONE canonical
-- lap/interval/swim set/strength exercise/multisport leg. Never mixes
-- separate segments into a false same-source disagreement.
-- NOT a migration; NO client grant, no fabricated/estimated metrics.
CREATE FUNCTION allin_private.v2_activity_segment_scalar_projection_candidate(
 p_user_id uuid,p_activity_id uuid,p_segment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $segment_projection$
DECLARE
 v_sport text;
 v_values jsonb;
 v_conflicts jsonb;
BEGIN
 IF p_user_id IS NULL OR p_activity_id IS NULL OR p_segment_id IS NULL THEN
  RAISE EXCEPTION 'Segment owner and identity required' USING ERRCODE='22023'; END IF;
 SELECT a.sport INTO v_sport
 FROM public.v2_completed_activities a
 JOIN public.v2_activity_segments seg
   ON seg.activity_id=a.id AND seg.user_id=a.user_id AND seg.id=p_segment_id
 WHERE a.id=p_activity_id AND a.user_id=p_user_id;
 IF v_sport IS NULL THEN
  RAISE EXCEPTION 'Activity segment not owned or unavailable' USING ERRCODE='42501';
 END IF;
 -- A metric is "agreed" only when trusted/partial evidence for this exact
 -- segment has one typed value and measurement kind across all sources.
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,d.canonical_unit,
    m.value_numeric,m.value_text,m.value_boolean,m.measurement_kind,
    CASE WHEN m.quality=s.quality THEN m.quality ELSE 'unverified' END AS quality
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
    ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
    ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.user_id=p_user_id AND m.activity_id=p_activity_id
    AND m.segment_id=p_segment_id AND d.status='published'
    AND v_sport=ANY(d.sport_scope)
 ), grouped AS (
  SELECT metric_code,definition_version,canonical_unit,
   count(*) AS source_count,
   count(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS insufficient,
   count(DISTINCT pg_catalog.jsonb_build_array(
      value_numeric,value_text,value_boolean,measurement_kind)) AS facts
  FROM rows GROUP BY metric_code,definition_version,canonical_unit
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'segmentId',p_segment_id,'metricCode',g.metric_code,
   'definitionVersion',g.definition_version,'canonicalUnit',g.canonical_unit,
   'sourceCount',g.source_count,
   'quality',CASE WHEN EXISTS(
      SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
        AND r.definition_version=g.definition_version AND r.quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'valueNumeric',(SELECT r.value_numeric FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'valueText',(SELECT r.value_text FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'valueBoolean',(SELECT r.value_boolean FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1),
   'measurementKind',(SELECT r.measurement_kind FROM rows r
      WHERE r.metric_code=g.metric_code AND r.definition_version=g.definition_version LIMIT 1)
 ) ORDER BY g.metric_code,g.definition_version),'[]'::jsonb)
 INTO v_values
 FROM grouped g WHERE g.insufficient=0 AND g.facts=1;
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,m.value_numeric,m.value_text,
   m.value_boolean,m.measurement_kind,
   CASE WHEN m.quality=s.quality THEN m.quality ELSE 'unverified' END AS quality
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
    ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
    ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.user_id=p_user_id AND m.activity_id=p_activity_id
    AND m.segment_id=p_segment_id AND d.status='published'
    AND v_sport=ANY(d.sport_scope)
 ), grouped AS (
   SELECT metric_code,definition_version,
     count(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS insufficient,
     count(DISTINCT pg_catalog.jsonb_build_array(
       value_numeric,value_text,value_boolean,measurement_kind)) AS facts
   FROM rows GROUP BY metric_code,definition_version
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'segmentId',p_segment_id,'metricCode',metric_code,
   'definitionVersion',definition_version,
   'reason',CASE WHEN insufficient>0 THEN 'source_review_required'
           ELSE 'conflicting_sources' END
 ) ORDER BY metric_code,definition_version),'[]'::jsonb)
 INTO v_conflicts
 FROM grouped WHERE insufficient>0 OR facts<>1;
 RETURN pg_catalog.jsonb_build_object('activityId',p_activity_id,
   'segmentId',p_segment_id,'metrics',v_values,
   'unresolvedMetrics',v_conflicts,'coverage','source_backed_segment_partial_registry');
END;
$segment_projection$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_segment_scalar_projection_candidate(
 uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
