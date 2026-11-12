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
 v_parent_sport text;
 v_activity_status text;
 v_values jsonb;
 v_conflicts jsonb;
BEGIN
 IF p_user_id IS NULL OR p_activity_id IS NULL OR p_segment_id IS NULL THEN
  RAISE EXCEPTION 'Segment owner and identity required' USING ERRCODE='22023'; END IF;
 -- An event's parent sport can be 'multisport', but power, running pace,
 -- swim stroke etc. are governed by the recorded LEG sport. Descendants
 -- inherit the nearest explicitly recorded ancestor sport in the SAME
 -- owner/activity graph. Never use a metric's own sport to infer the leg.
 WITH RECURSIVE lineage AS (
   SELECT seg.id,seg.parent_segment_id,seg.sport,0 AS depth
   FROM public.v2_activity_segments seg
   WHERE seg.id=p_segment_id AND seg.activity_id=p_activity_id AND seg.user_id=p_user_id
   UNION ALL
   SELECT parent.id,parent.parent_segment_id,parent.sport,child.depth+1
   FROM public.v2_activity_segments parent
   JOIN lineage child ON parent.id=child.parent_segment_id
   WHERE parent.activity_id=p_activity_id AND parent.user_id=p_user_id
     AND child.depth<32
 )
 SELECT a.sport,a.status,
   coalesce((SELECT l.sport FROM lineage l
     WHERE l.sport IS NOT NULL ORDER BY l.depth LIMIT 1),a.sport)
 INTO v_parent_sport,v_activity_status,v_sport
 FROM public.v2_completed_activities a
 WHERE a.id=p_activity_id AND a.user_id=p_user_id
   AND EXISTS(SELECT 1 FROM lineage);
 IF v_sport IS NULL THEN
  RAISE EXCEPTION 'Activity segment not owned or unavailable' USING ERRCODE='42501';
 END IF;
 -- Match the global projection: retain raw evidence privately, but do
 -- not display any segment measurements after parent invalidation.
 IF v_activity_status='invalidated' THEN
  RETURN pg_catalog.jsonb_build_object(
   'activityId',p_activity_id,'segmentId',p_segment_id,
   'metrics','[]'::jsonb,'unresolvedMetrics','[]'::jsonb,
   'coverage','invalidated_activity');
 END IF;
 IF v_parent_sport<>'multisport' AND v_sport<>v_parent_sport THEN
  RAISE EXCEPTION 'Segment sport contradicts canonical activity sport'
    USING ERRCODE='22023';
 END IF;
 -- A metric is "agreed" only when trusted/partial evidence for this exact
 -- segment has one typed value and measurement kind across all sources.
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,d.canonical_unit,
    m.value_numeric,m.value_text,m.value_boolean,m.measurement_kind,
   m.quality AS measurement_quality,s.quality AS source_quality,
    CASE
      WHEN m.quality IN ('trusted','partial') AND s.quality IN ('trusted','partial')
       THEN CASE WHEN m.quality='partial' OR s.quality='partial'
                 THEN 'partial' ELSE 'trusted' END
      ELSE 'unverified'
    END AS quality
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
   'measurementQuality',CASE WHEN EXISTS(
     SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
      AND r.definition_version=g.definition_version AND r.measurement_quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'sourceQuality',CASE WHEN EXISTS(
     SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
      AND r.definition_version=g.definition_version AND r.source_quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
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
 FROM grouped g WHERE g.insufficient=0 AND g.facts=1
 AND (SELECT count(DISTINCT r.definition_version) FROM rows r
      WHERE r.metric_code=g.metric_code)=1;
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,m.value_numeric,m.value_text,
   m.value_boolean,m.measurement_kind,
   CASE
      WHEN m.quality IN ('trusted','partial') AND s.quality IN ('trusted','partial')
       THEN CASE WHEN m.quality='partial' OR s.quality='partial'
                 THEN 'partial' ELSE 'trusted' END
      ELSE 'unverified'
    END AS quality
  FROM public.v2_activity_metric_values m
  JOIN public.v2_activity_sources s
    ON s.id=m.source_id AND s.activity_id=m.activity_id AND s.user_id=m.user_id
  JOIN public.v2_activity_metric_definitions d
    ON d.metric_code=m.metric_code AND d.definition_version=m.definition_version
  WHERE m.user_id=p_user_id AND m.activity_id=p_activity_id
    AND m.segment_id=p_segment_id AND d.status='published'
    AND v_sport=ANY(d.sport_scope)
 ), grouped AS (
   SELECT metric_code,MIN(definition_version) AS definition_version,
     count(DISTINCT definition_version) AS version_count,
     count(*) FILTER(WHERE quality NOT IN ('trusted','partial')) AS insufficient,
     count(DISTINCT pg_catalog.jsonb_build_array(
       value_numeric,value_text,value_boolean,measurement_kind)) AS facts
   FROM rows GROUP BY metric_code
 )
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'segmentId',p_segment_id,'metricCode',metric_code,
   'definitionVersion',CASE WHEN version_count=1 THEN definition_version ELSE NULL END,
   'reason',CASE WHEN version_count>1 THEN 'conflicting_versions'
           WHEN insufficient>0 THEN 'source_review_required'
           ELSE 'conflicting_sources' END
 ) ORDER BY metric_code,definition_version),'[]'::jsonb)
 INTO v_conflicts
 FROM grouped WHERE version_count>1 OR insufficient>0 OR facts<>1;
 RETURN pg_catalog.jsonb_build_object('activityId',p_activity_id,
   'segmentId',p_segment_id,'metrics',v_values,
   'unresolvedMetrics',v_conflicts,'coverage','source_backed_segment_partial_registry');
END;
$segment_projection$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_segment_scalar_projection_candidate(
 uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
