-- ALL-243 REVIEW ONLY: typed semantic segments within ONE canonical Completed Activity.
-- NOT A MIGRATION. No production deployment, client grants, sensor data copies.
-- Preserves lap/split/interval/swim-set/strength-block/leg/transition identities.
BEGIN;
CREATE TABLE public.v2_activity_segments (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL,
 user_id uuid NOT NULL,
 parent_segment_id uuid,
 segment_kind text NOT NULL CHECK(segment_kind IN (
   'lap','split','interval','swim_set','swim_length','multisport_leg',
   'transition','strength_block','strength_exercise','recovery_block')),
 sequence_number integer NOT NULL CHECK(sequence_number>=1),
 sport text CHECK(sport IS NULL OR sport IN (
   'running','walking','cycling','swimming','strength','hiking','rucking',
   'rowing','elliptical','stair','yoga','mobility','hiit','multisport','other')),
 label text CHECK(label IS NULL OR length(label)<=160),
 started_at timestamptz,
 finished_at timestamptz,
 elapsed_seconds integer CHECK(elapsed_seconds IS NULL OR elapsed_seconds>=0),
 distance_meters numeric CHECK(distance_meters IS NULL OR distance_meters>=0),
 source_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,activity_id,user_id),
 -- PG17 NULLS NOT DISTINCT prevents duplicate root sequence 1.
 UNIQUE NULLS NOT DISTINCT(activity_id,parent_segment_id,sequence_number),
 FOREIGN KEY(activity_id,user_id)
   REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(parent_segment_id,activity_id,user_id)
   REFERENCES public.v2_activity_segments(id,activity_id,user_id),
 FOREIGN KEY(source_id,activity_id,user_id)
   REFERENCES public.v2_activity_sources(id,activity_id,user_id),
 CHECK(parent_segment_id IS NULL OR parent_segment_id<>id),
 CHECK(finished_at IS NULL OR started_at IS NULL OR finished_at>=started_at)
);
CREATE INDEX v2_activity_segments_owner_activity
 ON public.v2_activity_segments(user_id,activity_id,parent_segment_id,sequence_number);
-- The metric's semantic owner is the same activity/athlete and one real segment.
-- The base scalar candidate reserves nullable segment_id for global-vs-
-- segment identity; this stage installs its same-owner FK.
ALTER TABLE public.v2_activity_metric_values
 ADD CONSTRAINT v2_activity_metric_segment_owner_fk
 FOREIGN KEY(segment_id,activity_id,user_id)
 REFERENCES public.v2_activity_segments(id,activity_id,user_id);
-- Distinguish activity-global observations from per-segment observations:
-- a metric from one source and one segment is unique, but other segments
-- may legitimately report the same metric key and definition.
ALTER TABLE public.v2_activity_metric_values
 DROP CONSTRAINT v2_activity_metric_global_source_unique;
ALTER TABLE public.v2_activity_metric_values
 ADD CONSTRAINT v2_activity_metric_segment_source_unique
 UNIQUE NULLS NOT DISTINCT (
   activity_id,user_id,segment_id,source_id,metric_code,definition_version
 );
ALTER TABLE public.v2_activity_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_activity_segments FROM PUBLIC,anon,authenticated;
-- Raw client inserts, activity metric ingestion grants, or generic workout
-- reassignment must remain disabled until source-authenticated writer review.
COMMIT;


-- ALL-243: reject cyclic parent links before source/segment projections read them.
-- Serialize graph edits for this activity to prevent concurrent opposite-edge
-- updates from independently passing a stale parent-chain read.
CREATE FUNCTION allin_private.v2_activity_segment_acyclic_guard_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $segment_guard$
DECLARE
 v_cursor uuid;
 v_next uuid;
 v_depth integer:=0;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-segment-graph:'||NEW.activity_id::text,0));
 v_cursor:=NEW.parent_segment_id;
 WHILE v_cursor IS NOT NULL LOOP
   IF v_cursor=NEW.id THEN
     RAISE EXCEPTION 'Activity segment parent cycle prohibited'
       USING ERRCODE='23514'; END IF;
   v_depth:=v_depth+1;
   IF v_depth>32 THEN
     RAISE EXCEPTION 'Activity segment ancestry exceeds supported depth'
       USING ERRCODE='23514'; END IF;
   SELECT parent_segment_id INTO v_next
   FROM public.v2_activity_segments
   WHERE id=v_cursor AND activity_id=NEW.activity_id AND user_id=NEW.user_id;
   -- Missing or cross-owner parent is rejected by the same-owner FK.
   IF NOT FOUND THEN EXIT; END IF;
   v_cursor:=v_next;
 END LOOP;
 RETURN NEW;
END;
$segment_guard$;
CREATE TRIGGER v2_guard_activity_segment_acyclic
 BEFORE INSERT OR UPDATE OF parent_segment_id ON public.v2_activity_segments
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_activity_segment_acyclic_guard_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_activity_segment_acyclic_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;

-- ALL-243: trusted, source-bound SEGMENT scalar writer for the same canonical
-- metric_values table as global observations. No new activity/metric store.
-- PRIVATE CANDIDATE ONLY: never grant a mobile/Coach client EXECUTE.
-- Provider verification, segment certification and publication remain external
-- trusted-service responsibilities; this cannot self-certify measurements.
CREATE FUNCTION allin_private.v2_activity_append_segment_scalar_candidate(
 p_user_id uuid,p_activity_id uuid,p_segment_id uuid,p_source_id uuid,
 p_value_id uuid,p_metric_code text,p_definition_version integer,
 p_measurement_kind text,p_value_numeric numeric,p_value_text text,
 p_value_boolean boolean,p_source_payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $segment_writer$
DECLARE
 v_activity public.v2_completed_activities%ROWTYPE;
 v_source public.v2_activity_sources%ROWTYPE;
 v_segment public.v2_activity_segments%ROWTYPE;
 v_definition public.v2_activity_metric_definitions%ROWTYPE;
 v_existing public.v2_activity_metric_values%ROWTYPE;
 v_sport text;
 v_quality text;
BEGIN
 IF p_user_id IS NULL OR p_activity_id IS NULL OR p_segment_id IS NULL
    OR p_source_id IS NULL OR p_value_id IS NULL OR p_metric_code IS NULL
    OR p_definition_version IS NULL OR p_measurement_kind IS NULL
    OR p_source_payload_hash IS NULL
    OR p_source_payload_hash !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid segment metric evidence' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-metric:'||p_user_id::text,0));
 SELECT * INTO v_activity FROM public.v2_completed_activities
 WHERE id=p_activity_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR v_activity.status='invalidated' THEN
   RAISE EXCEPTION 'Segment activity absent or owner mismatch'
     USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.v2_activity_sources
 WHERE id=p_source_id AND activity_id=p_activity_id AND user_id=p_user_id FOR SHARE;
 IF NOT FOUND OR v_source.quality='rejected' THEN
   RAISE EXCEPTION 'Segment source absent or owner mismatch'
     USING ERRCODE='42501'; END IF;
 IF v_source.source_payload_hash IS DISTINCT FROM p_source_payload_hash THEN
   RAISE EXCEPTION 'Segment source fingerprint changed' USING ERRCODE='23505'; END IF;
 SELECT * INTO v_segment FROM public.v2_activity_segments
 WHERE id=p_segment_id AND activity_id=p_activity_id AND user_id=p_user_id FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Segment does not belong to activity and owner'
     USING ERRCODE='42501'; END IF;
 -- A segment's source_id records its primary provenance; other
 -- independently verified same-owner sources can legitimately contribute
 -- evidence. Their disagreements must survive as separate sourced rows.
 -- The source FK, source fingerprint and segment FK are checked above.
 -- Trusted ingestion still must certify that this source observed this leg.
 -- Parent multisport uses the nearest explicit leg/ancestor sport, not the
 -- synthetic parent label. The depth cap bounds traversal; cyclic hierarchy
 -- mutation remains prohibited by a separate owner/trigger acceptance gate.
 WITH RECURSIVE lineage AS (
   SELECT seg.id,seg.parent_segment_id,seg.sport,0 AS depth,
          ARRAY[seg.id]::uuid[] AS visited
   FROM public.v2_activity_segments seg
   WHERE seg.id=p_segment_id AND seg.activity_id=p_activity_id AND seg.user_id=p_user_id
   UNION ALL
   SELECT parent.id,parent.parent_segment_id,parent.sport,child.depth+1,
          child.visited||parent.id
   FROM public.v2_activity_segments parent
   JOIN lineage child ON parent.id=child.parent_segment_id
   WHERE parent.activity_id=p_activity_id AND parent.user_id=p_user_id
     AND child.depth<32 AND NOT parent.id=ANY(child.visited)
 )
 SELECT coalesce((SELECT l.sport FROM lineage l
    WHERE l.sport IS NOT NULL ORDER BY l.depth LIMIT 1),v_activity.sport)
 INTO v_sport;
 IF v_activity.sport<>'multisport' AND v_sport<>v_activity.sport THEN
   RAISE EXCEPTION 'Segment sport contradicts completed activity'
     USING ERRCODE='22023'; END IF;
 SELECT * INTO v_definition FROM public.v2_activity_metric_definitions
 WHERE metric_code=p_metric_code AND definition_version=p_definition_version
   AND status='published';
 IF NOT FOUND OR NOT v_sport=ANY(v_definition.sport_scope)
    OR NOT p_measurement_kind=ANY(v_definition.measurement_kinds) THEN
   RAISE EXCEPTION 'Metric incompatible with certified segment sport'
     USING ERRCODE='22023'; END IF;
 IF (v_definition.value_kind='numeric' AND
    (p_value_numeric IS NULL OR p_value_text IS NOT NULL OR p_value_boolean IS NOT NULL))
 OR (v_definition.value_kind='text' AND
    (p_value_text IS NULL OR p_value_numeric IS NOT NULL OR p_value_boolean IS NOT NULL))
 OR (v_definition.value_kind='boolean' AND
    (p_value_boolean IS NULL OR p_value_numeric IS NOT NULL OR p_value_text IS NOT NULL))
 THEN RAISE EXCEPTION 'Segment scalar type mismatch' USING ERRCODE='22023'; END IF;
 v_quality:=v_source.quality;
 SELECT * INTO v_existing FROM public.v2_activity_metric_values
 WHERE activity_id=p_activity_id AND user_id=p_user_id
   AND segment_id=p_segment_id AND source_id=p_source_id
   AND metric_code=p_metric_code AND definition_version=p_definition_version
 FOR UPDATE;
 IF FOUND THEN
   IF v_existing.id<>p_value_id OR
      v_existing.measurement_kind<>p_measurement_kind OR
      v_existing.value_numeric IS DISTINCT FROM p_value_numeric OR
      v_existing.value_text IS DISTINCT FROM p_value_text OR
      v_existing.value_boolean IS DISTINCT FROM p_value_boolean OR
      v_existing.source_payload_hash IS DISTINCT FROM p_source_payload_hash THEN
     RAISE EXCEPTION 'Conflicting same-segment source metric retry'
       USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('metricId',v_existing.id,
       'segmentId',p_segment_id,'replayed',true);
 END IF;
 INSERT INTO public.v2_activity_metric_values(
   id,activity_id,user_id,segment_id,source_id,metric_code,definition_version,
   value_numeric,value_text,value_boolean,measurement_kind,quality,source_payload_hash
 ) VALUES(
   p_value_id,p_activity_id,p_user_id,p_segment_id,p_source_id,p_metric_code,
   p_definition_version,p_value_numeric,p_value_text,p_value_boolean,
   p_measurement_kind,v_quality,p_source_payload_hash);
 RETURN pg_catalog.jsonb_build_object('metricId',p_value_id,
    'segmentId',p_segment_id,'replayed',false);
END;
$segment_writer$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_append_segment_scalar_candidate(
 uuid,uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text)
 FROM PUBLIC,anon,authenticated,service_role;
