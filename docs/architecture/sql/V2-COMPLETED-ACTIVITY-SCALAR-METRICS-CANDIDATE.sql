-- ALL-243 REVIEW ONLY: provenance-bound scalar Completed Activity metrics.
-- NOT A MIGRATION. NO CLIENT GRANTS, NO METRIC VERIFICATION CLAIM.
-- Depends on canonical v2_completed_activities and v2_activity_sources.
-- Source-authoritative ingest and sport taxonomy remain separate owner gates.
BEGIN;
-- Stable semantic registry; units and applicability are versioned.
CREATE TABLE public.v2_activity_metric_definitions (
 metric_code text NOT NULL CHECK(length(btrim(metric_code)) BETWEEN 1 AND 100),
 definition_version integer NOT NULL CHECK(definition_version>=1),
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 120),
 canonical_unit text NOT NULL CHECK(length(btrim(canonical_unit)) BETWEEN 1 AND 50),
 value_kind text NOT NULL CHECK(value_kind IN ('numeric','text','boolean')),
 sport_scope text[] NOT NULL CHECK(cardinality(sport_scope) BETWEEN 1 AND 20),
 measurement_kinds text[] NOT NULL CHECK(
    cardinality(measurement_kinds) BETWEEN 1 AND 5 AND
    measurement_kinds <@ ARRAY['source_measured','provider_derived',
      'user_reported','allin_derived','estimated']::text[]),
 comparison_class text,
 display_group text NOT NULL CHECK(length(btrim(display_group)) BETWEEN 1 AND 80),
 privacy_class text NOT NULL CHECK(privacy_class IN ('private','sensitive','shareable_with_consent')),
 status text NOT NULL DEFAULT 'candidate'
   CHECK(status IN ('candidate','published','retired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(metric_code,definition_version),
 CHECK(sport_scope <@ ARRAY['running','walking','cycling','swimming','strength','hiking',
  'rucking','rowing','elliptical','stair','yoga','mobility','hiit','multisport','other']::text[])
);
CREATE TABLE public.v2_activity_metric_values (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL,
 user_id uuid NOT NULL,
 source_id uuid NOT NULL,
 -- NULL denotes an activity-global fact. Segment FK is installed only when
 -- the owning semantic segments candidate is activated later in the release.
 segment_id uuid,
 metric_code text NOT NULL,
 definition_version integer NOT NULL,
 value_numeric numeric,
 value_text text CHECK(value_text IS NULL OR length(value_text)<=500),
 value_boolean boolean,
 measurement_kind text NOT NULL CHECK(measurement_kind IN
  ('source_measured','provider_derived','user_reported','allin_derived','estimated')),
 quality text NOT NULL CHECK(quality IN
  ('trusted','partial','unverified','low_quality','rejected')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^[0-9a-f]{64}$'),
 -- Zero is a recorded value, not absence. Exactly one typed fact.
 CHECK((CASE WHEN value_numeric IS NULL THEN 0 ELSE 1 END)+
       (CASE WHEN value_text IS NULL THEN 0 ELSE 1 END)+
       (CASE WHEN value_boolean IS NULL THEN 0 ELSE 1 END)=1),
 FOREIGN KEY(activity_id,user_id)
   REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(metric_code,definition_version)
   REFERENCES public.v2_activity_metric_definitions(metric_code,definition_version),
 -- Cross-owner/source joins must prove the source belongs to the SAME activity.
 CONSTRAINT v2_activity_metric_global_source_unique UNIQUE(activity_id,user_id,source_id,metric_code,definition_version)
);
ALTER TABLE public.v2_activity_sources
 ADD CONSTRAINT v2_activity_source_metric_owner_key
 UNIQUE(id,activity_id,user_id);
ALTER TABLE public.v2_activity_metric_values
 ADD CONSTRAINT v2_activity_metric_source_owner_fk
 FOREIGN KEY(source_id,activity_id,user_id)
 REFERENCES public.v2_activity_sources(id,activity_id,user_id);
CREATE INDEX v2_activity_metric_owner_code
 ON public.v2_activity_metric_values(user_id,activity_id,metric_code);
ALTER TABLE public.v2_activity_metric_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_activity_metric_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_activity_metric_definitions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_activity_metric_values FROM PUBLIC,anon,authenticated;
-- Registry is release-owned. Client cannot make new metric semantics or
-- award verified cycling status by inserting a scalar.
COMMIT;

CREATE FUNCTION allin_private.v2_activity_append_scalar_candidate(
 p_user_id uuid,p_activity_id uuid,p_source_id uuid,p_value_id uuid,
 p_metric_code text,p_definition_version integer,p_measurement_kind text,
 p_value_numeric numeric,p_value_text text,p_value_boolean boolean,
 p_source_payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $writer$
DECLARE
 v_activity public.v2_completed_activities%ROWTYPE;
 v_source public.v2_activity_sources%ROWTYPE;
 v_definition public.v2_activity_metric_definitions%ROWTYPE;
 v_existing public.v2_activity_metric_values%ROWTYPE;
 v_quality text;
BEGIN
 IF p_user_id IS NULL OR p_activity_id IS NULL OR p_source_id IS NULL
  OR p_value_id IS NULL OR p_metric_code IS NULL OR p_definition_version IS NULL
  OR p_measurement_kind IS NULL OR p_source_payload_hash IS NULL
  OR p_source_payload_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Invalid scalar metric evidence' USING ERRCODE='22023';
 END IF;
 -- Serialize owner-scoped ingest, not arbitrary UI display projection.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-metric:'||p_user_id::text,0));
 SELECT * INTO v_activity FROM public.v2_completed_activities
  WHERE id=p_activity_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR v_activity.status='invalidated' THEN
  RAISE EXCEPTION 'Activity missing or not owned' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.v2_activity_sources
  WHERE id=p_source_id AND user_id=p_user_id
    AND activity_id=p_activity_id FOR SHARE;
 IF NOT FOUND OR v_source.quality='rejected' THEN
  RAISE EXCEPTION 'Rejected or cross-owner source' USING ERRCODE='42501'; END IF;
 -- The source must match the evidence hash; no arbitrary user value
 -- can cite an unrelated device/workout and claim provenance.
 IF v_source.source_payload_hash IS DISTINCT FROM p_source_payload_hash THEN
  RAISE EXCEPTION 'Source provenance mismatch' USING ERRCODE='23505'; END IF;
 SELECT * INTO v_definition FROM public.v2_activity_metric_definitions
  WHERE metric_code=p_metric_code AND definition_version=p_definition_version
    AND status='published';
 IF NOT FOUND OR NOT v_activity.sport=ANY(v_definition.sport_scope)
  OR NOT p_measurement_kind=ANY(v_definition.measurement_kinds) THEN
  RAISE EXCEPTION 'Unsupported metric semantics for sport/source'
   USING ERRCODE='22023'; END IF;
 IF (v_definition.value_kind='numeric' AND
    (p_value_numeric IS NULL OR p_value_text IS NOT NULL OR p_value_boolean IS NOT NULL))
 OR (v_definition.value_kind='text' AND
    (p_value_text IS NULL OR p_value_numeric IS NOT NULL OR p_value_boolean IS NOT NULL))
 OR (v_definition.value_kind='boolean' AND
    (p_value_boolean IS NULL OR p_value_numeric IS NOT NULL OR p_value_text IS NOT NULL))
 THEN RAISE EXCEPTION 'Metric value kind mismatch' USING ERRCODE='22023'; END IF;
 v_quality:=v_source.quality;
 SELECT * INTO v_existing FROM public.v2_activity_metric_values
   WHERE activity_id=p_activity_id AND user_id=p_user_id
     AND segment_id IS NULL AND source_id=p_source_id AND metric_code=p_metric_code
     AND definition_version=p_definition_version FOR UPDATE;
 IF FOUND THEN
  IF v_existing.id<>p_value_id OR
    v_existing.measurement_kind<>p_measurement_kind OR
    v_existing.value_numeric IS DISTINCT FROM p_value_numeric OR
    v_existing.value_text IS DISTINCT FROM p_value_text OR
    v_existing.value_boolean IS DISTINCT FROM p_value_boolean OR
    v_existing.source_payload_hash<>p_source_payload_hash THEN
    RAISE EXCEPTION 'Conflicting metric source replay' USING ERRCODE='23505';
  END IF;
  RETURN pg_catalog.jsonb_build_object('metricId',v_existing.id,
    'activityId',p_activity_id,'replayed',true);
 END IF;
 INSERT INTO public.v2_activity_metric_values
  (id,activity_id,user_id,source_id,metric_code,definition_version,
   value_numeric,value_text,value_boolean,measurement_kind,quality,source_payload_hash)
 VALUES(p_value_id,p_activity_id,p_user_id,p_source_id,p_metric_code,
  p_definition_version,p_value_numeric,p_value_text,p_value_boolean,
  p_measurement_kind,v_quality,p_source_payload_hash);
 RETURN pg_catalog.jsonb_build_object('metricId',p_value_id,
    'activityId',p_activity_id,'replayed',false);
END;
$writer$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_append_scalar_candidate(
 uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text)
 FROM PUBLIC,anon,authenticated,service_role;
-- No client/Coach/competition execution grants. The trusted device
-- adapter/metric-review process must perform actual source authentication
-- and registry publishing. This function does NOT adjudicate selected values.
