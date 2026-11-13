-- ALL-222/243/246 REVIEW ONLY. DO NOT MERGE/DEPLOY. Unit 2 of 5.
-- Canonical provenance, versioned sport metrics, segments, strength sets, and scalar projection.

-- Source 7: V2-COMPLETED-ACTIVITY-SOURCE-WRITER-CANDIDATE.sql [Git blob 1358d01cefc488db27a9233ccd6dcde14c59b784]
-- ALL-243 REVIEW ONLY: owner-bound source attachment to canonical Completed Activity.
-- NOT A MIGRATION. Private SECURITY INVOKER only, NO app/client EXECUTE.
-- Trusted backend must derive provider/source evidence and own authentication;
-- this helper must never be exposed as a client-facing source attestation.
-- Does not calculate power, distance, calories, FTP, or competition eligibility.
CREATE FUNCTION allin_private.v2_activity_attach_source_candidate(
 p_owner_id uuid,p_activity_id uuid,p_source_id uuid,p_provider text,
 p_source_kind text,p_source_record_id text,p_quality text,
 p_source_hash text,p_captured_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $attach$
DECLARE
 v_source public.v2_activity_sources%ROWTYPE;
 v_activity public.v2_completed_activities%ROWTYPE;
BEGIN
 IF p_owner_id IS NULL OR p_activity_id IS NULL OR p_source_id IS NULL
    OR p_provider IS NULL OR p_source_kind IS NULL OR p_source_record_id IS NULL
    OR p_quality IS NULL OR p_source_hash IS NULL
    OR p_source_hash !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid canonical source reference' USING ERRCODE='22023'; END IF;
 -- Lock order: metric owner fence FIRST, source identity SECOND. This
 -- coordinates source attachment with invalidation/scalar ingestion and
 -- avoids inversion against the activity/source UPDATE triggers.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-metric:'||p_owner_id::text,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-activity-source:'||p_owner_id::text,0));
 SELECT * INTO v_activity FROM public.v2_completed_activities
  WHERE id=p_activity_id AND user_id=p_owner_id FOR UPDATE;
 IF NOT FOUND OR v_activity.status='invalidated' THEN
   RAISE EXCEPTION 'Canonical activity missing or owner mismatch' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.v2_activity_sources
  WHERE user_id=p_owner_id AND provider=p_provider AND
   source_kind=p_source_kind AND source_record_id=p_source_record_id FOR UPDATE;
 IF FOUND THEN
   IF v_source.activity_id<>p_activity_id OR v_source.id<>p_source_id
      OR v_source.source_payload_hash IS DISTINCT FROM p_source_hash
      OR v_source.quality<>p_quality
      OR v_source.captured_at IS DISTINCT FROM p_captured_at
   THEN RAISE EXCEPTION 'Conflicting provider source identity or revision'
      USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('activityId',p_activity_id,
      'sourceId',v_source.id,'replayed',true);
 END IF;
 INSERT INTO public.v2_activity_sources(
   id,activity_id,user_id,provider,source_kind,source_record_id,quality,
   source_payload_hash,captured_at)
 VALUES(p_source_id,p_activity_id,p_owner_id,p_provider,p_source_kind,
    p_source_record_id,p_quality,p_source_hash,p_captured_at);
 RETURN pg_catalog.jsonb_build_object('activityId',p_activity_id,
    'sourceId',p_source_id,'replayed',false);
END;
$attach$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_attach_source_candidate(
 uuid,uuid,uuid,text,text,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;


-- Source 8: V2-COMPLETED-ACTIVITY-SCALAR-METRICS-CANDIDATE.sql [Git blob d7362389da145e8565e517a3ac2679e7321d9a9d]
-- ALL-243 REVIEW ONLY: provenance-bound scalar Completed Activity metrics.
-- NOT A MIGRATION. NO CLIENT GRANTS, NO METRIC VERIFICATION CLAIM.
-- Depends on canonical v2_completed_activities and v2_activity_sources.
-- Source-authoritative ingest and sport taxonomy remain separate owner gates.
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

CREATE FUNCTION allin_private.v2_activity_append_scalar_candidate(
 p_user_id uuid,p_activity_id uuid,p_source_id uuid,p_value_id uuid,
 p_metric_code text,p_definition_version integer,p_measurement_kind text,
 p_value_numeric numeric,p_value_text text,p_value_boolean boolean,
 p_source_payload_hash text,p_measurement_quality text DEFAULT NULL
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
 -- Serialize scalar ingest for this owner without granting UPDATE to the
 -- read-and-append device capability. Uniqueness, FK ownership, and the
 -- transaction-scoped owner lock arbitrate retries and concurrent appends.
 -- Other activity/source lifecycle writers must honor this same lock before
 -- changing state/evidence; that cross-writer race is a release gate.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-metric:'||p_user_id::text,0));
 SELECT * INTO v_activity FROM public.v2_completed_activities
  WHERE id=p_activity_id AND user_id=p_user_id;
 IF NOT FOUND OR v_activity.status='invalidated' THEN
  RAISE EXCEPTION 'Activity missing or not owned' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.v2_activity_sources
  WHERE id=p_source_id AND user_id=p_user_id
    AND activity_id=p_activity_id;
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
 -- The adapter may report a worse sample than its parent source. A NULL
 -- legacy argument conservatively inherits source quality; no caller may
 -- claim a sample more reliable than its source.
 IF p_measurement_quality IS NOT NULL AND
    p_measurement_quality NOT IN ('trusted','partial','unverified','low_quality','rejected') THEN
   RAISE EXCEPTION 'Invalid measurement quality' USING ERRCODE='22023'; END IF;
 v_quality:=COALESCE(p_measurement_quality,v_source.quality);
 IF (v_source.quality='rejected' AND v_quality<>'rejected') OR
    (v_source.quality='low_quality' AND v_quality IN ('trusted','partial','unverified')) OR
    (v_source.quality='unverified' AND v_quality IN ('trusted','partial')) OR
    (v_source.quality='partial' AND v_quality='trusted') THEN
   RAISE EXCEPTION 'Measurement quality exceeds source certification' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_existing FROM public.v2_activity_metric_values
   WHERE activity_id=p_activity_id AND user_id=p_user_id
     AND segment_id IS NULL AND source_id=p_source_id AND metric_code=p_metric_code
     AND definition_version=p_definition_version;
 IF FOUND THEN
  IF v_existing.id<>p_value_id OR
    v_existing.measurement_kind<>p_measurement_kind OR
    v_existing.value_numeric IS DISTINCT FROM p_value_numeric OR
    v_existing.value_text IS DISTINCT FROM p_value_text OR
    v_existing.value_boolean IS DISTINCT FROM p_value_boolean OR
    v_existing.source_payload_hash<>p_source_payload_hash OR
    v_existing.quality<>v_quality THEN
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
 uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
-- No client/Coach/competition execution grants. The trusted device
-- adapter/metric-review process must perform actual source authentication
-- and registry publishing. This function does NOT adjudicate selected values.


-- ALL-243 cross-writer owner fence, review-only candidate.
-- These guards are attached to the canonical activity and source tables,
-- rather than trusting each backend caller to remember a lock. They preserve
-- raw historical evidence: invalidated/rejected facts are NOT deleted.
-- The lock namespace is the same as v2_activity_append_scalar_candidate.
CREATE FUNCTION allin_private.v2_activity_metric_owner_fence_candidate()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fence$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
   RAISE EXCEPTION 'Canonical activity/source identity is immutable'
    USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='v2_activity_sources' THEN
   IF NEW.activity_id IS DISTINCT FROM OLD.activity_id OR
      NEW.provider IS DISTINCT FROM OLD.provider OR
      NEW.source_kind IS DISTINCT FROM OLD.source_kind OR
      NEW.source_record_id IS DISTINCT FROM OLD.source_record_id OR
      NEW.source_revision IS DISTINCT FROM OLD.source_revision OR
      NEW.source_device_ref IS DISTINCT FROM OLD.source_device_ref OR
      NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'Registered source identity and activity binding are immutable'
     USING ERRCODE='42501';
   END IF;
  ELSIF TG_TABLE_NAME='v2_completed_activities' THEN
   IF NEW.sport IS DISTINCT FROM OLD.sport THEN
    RAISE EXCEPTION 'Canonical completed activity sport is immutable'
     USING ERRCODE='42501';
   END IF;
  END IF;
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-metric:'||OLD.user_id::text,0));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$fence$;
REVOKE ALL ON FUNCTION allin_private.v2_activity_metric_owner_fence_candidate()
 FROM PUBLIC,anon,authenticated,service_role;

-- Fire for every UPDATE (including identity-only or evidence metadata changes),
-- not just a subset of column-specific mutations.
CREATE TRIGGER v2_metric_activity_state_fence_candidate
 BEFORE UPDATE OR DELETE ON public.v2_completed_activities
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_activity_metric_owner_fence_candidate();

CREATE TRIGGER v2_metric_source_quality_fence_candidate
 BEFORE UPDATE OR DELETE ON public.v2_activity_sources
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_activity_metric_owner_fence_candidate();


-- Source 9: V2-COMPLETED-ACTIVITY-METRIC-DEFINITION-GUARD-CANDIDATE.sql [Git blob 7b373e160f9319f1bc5712f77b6f8baef4013e87]
-- ALL-243 REVIEW ONLY: immutable published metric semantics.
-- NOT A MIGRATION; attach to existing metric registry candidate only.
-- Metric code/version/units/applicability cannot change under older workouts.
CREATE FUNCTION allin_private.v2_activity_guard_metric_definition_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $immutable$
BEGIN
 IF TG_OP='DELETE' AND OLD.status IN ('published','retired') THEN
  RAISE EXCEPTION 'Published metric definitions cannot be deleted'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('published','retired') THEN
  RAISE EXCEPTION 'Published metric definitions are immutable'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$immutable$;
CREATE TRIGGER v2_activity_guard_metric_registry
 BEFORE UPDATE OR DELETE ON public.v2_activity_metric_definitions
 FOR EACH ROW
 EXECUTE FUNCTION allin_private.v2_activity_guard_metric_definition_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_activity_guard_metric_definition_candidate()
 FROM PUBLIC,anon,authenticated,service_role;


-- Source 10: V2-COMPLETED-ACTIVITY-SEGMENTS-CANDIDATE.sql [Git blob bed393eb11d15ef64b1123871786544e5ae1a925]
-- ALL-243 REVIEW ONLY: typed semantic segments within ONE canonical Completed Activity.
-- NOT A MIGRATION. No production deployment, client grants, sensor data copies.
-- Preserves lap/split/interval/swim-set/strength-block/leg/transition identities.
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
 -- Identity movement would relabel already persisted, source-backed facts.
 -- A new physical segment must get a new identity, not be reassigned.
 IF TG_OP='UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.activity_id IS DISTINCT FROM OLD.activity_id OR
    NEW.user_id IS DISTINCT FROM OLD.user_id
 ) THEN
   RAISE EXCEPTION 'Activity segment identity and owner cannot change'
     USING ERRCODE='23514';
 END IF;
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
 BEFORE INSERT OR UPDATE OF parent_segment_id, activity_id, user_id, id
 ON public.v2_activity_segments
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
 p_value_boolean boolean,p_source_payload_hash text,
 p_measurement_quality text DEFAULT NULL
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
 -- A verified provider may certify an individual sample below its source.
 -- Legacy callers default conservatively to source quality.
 IF p_measurement_quality IS NOT NULL AND
    p_measurement_quality NOT IN ('trusted','partial','unverified','low_quality','rejected') THEN
   RAISE EXCEPTION 'Invalid segment measurement quality' USING ERRCODE='22023'; END IF;
 v_quality:=COALESCE(p_measurement_quality,v_source.quality);
 IF (v_source.quality='rejected' AND v_quality<>'rejected') OR
    (v_source.quality='low_quality' AND v_quality IN ('trusted','partial','unverified')) OR
    (v_source.quality='unverified' AND v_quality IN ('trusted','partial')) OR
    (v_source.quality='partial' AND v_quality='trusted') THEN
   RAISE EXCEPTION 'Segment measurement exceeds source certification' USING ERRCODE='22023'; END IF;
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
      v_existing.source_payload_hash IS DISTINCT FROM p_source_payload_hash OR
      v_existing.quality<>v_quality THEN
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
 uuid,uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text,text)
 FROM PUBLIC,anon,authenticated,service_role;


-- Source 11: V2-COMPLETED-ACTIVITY-STRENGTH-SETS-CANDIDATE.sql [Git blob b00f6ac5289928c4b06f3afc72345eb25054f1b9]
-- ALL-243 / ALL-258 REVIEW ONLY: typed performed strength sets.
-- NOT A MIGRATION. No production deployment or client GRANT.
-- Uses the same canonical Completed Activity, source, and semantic segment
-- identities. Exercise ID has NO unapproved exercise-catalog FK yet.
CREATE TABLE public.v2_activity_strength_sets (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL,
 user_id uuid NOT NULL,
 exercise_segment_id uuid NOT NULL,
 source_id uuid NOT NULL,
 exercise_id uuid,
 set_index integer NOT NULL CHECK(set_index >= 1),
 set_kind text NOT NULL CHECK(set_kind IN
  ('warmup','working','drop','failure','amrap','bodyweight','assisted','other')),
 reps integer CHECK(reps IS NULL OR reps >= 0),
 load_value numeric CHECK(load_value IS NULL OR load_value >= 0),
 load_unit text CHECK(load_unit IS NULL OR load_unit IN ('kg','lb')),
 load_mode text NOT NULL CHECK(load_mode IN
   ('external_load','bodyweight','assisted','unknown')),
 rpe numeric CHECK(rpe IS NULL OR rpe BETWEEN 0 AND 10),
 rir integer CHECK(rir IS NULL OR rir BETWEEN 0 AND 20),
 duration_seconds integer CHECK(duration_seconds IS NULL OR duration_seconds >= 0),
 quality text NOT NULL CHECK(quality IN
  ('trusted','partial','unverified','low_quality','rejected')),
 captured_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE NULLS NOT DISTINCT(activity_id,exercise_segment_id,source_id,set_index),
 FOREIGN KEY(activity_id,user_id)
   REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(exercise_segment_id,activity_id,user_id)
   REFERENCES public.v2_activity_segments(id,activity_id,user_id),
 FOREIGN KEY(source_id,activity_id,user_id)
   REFERENCES public.v2_activity_sources(id,activity_id,user_id),
 CHECK((load_mode='external_load' AND load_value IS NOT NULL AND load_unit IS NOT NULL)
  OR (load_mode<>'external_load' AND load_value IS NULL AND load_unit IS NULL))
);
CREATE FUNCTION allin_private.v2_activity_guard_strength_set_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $check$
DECLARE
 v_sport text;
 v_segment_kind text;
 v_source_quality text;
BEGIN
 SELECT sport INTO v_sport FROM public.v2_completed_activities
 WHERE id=NEW.activity_id AND user_id=NEW.user_id;
 SELECT segment_kind INTO v_segment_kind FROM public.v2_activity_segments
 WHERE id=NEW.exercise_segment_id AND activity_id=NEW.activity_id
   AND user_id=NEW.user_id;
 SELECT quality INTO v_source_quality FROM public.v2_activity_sources
 WHERE id=NEW.source_id AND activity_id=NEW.activity_id AND user_id=NEW.user_id;
 IF v_sport IS DISTINCT FROM 'strength'
    OR v_segment_kind IS DISTINCT FROM 'strength_exercise'
    OR v_source_quality IS DISTINCT FROM NEW.quality
 THEN RAISE EXCEPTION 'Strength set must match canonical sport, exercise segment and source quality'
   USING ERRCODE='22023'; END IF;
 RETURN NEW;
END;
$check$;
CREATE TRIGGER v2_guard_activity_strength_set
 BEFORE INSERT OR UPDATE ON public.v2_activity_strength_sets
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_activity_guard_strength_set_candidate();
CREATE INDEX v2_strength_set_activity_exercise
 ON public.v2_activity_strength_sets(user_id,activity_id,exercise_segment_id,set_index);
ALTER TABLE public.v2_activity_strength_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_activity_strength_sets FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION allin_private.v2_activity_guard_strength_set_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
-- No direct exercise catalog duplication; exercise_id remains nullable until
-- ALL-258 publishes its canonical approved exercise table and FK.
-- A bodyweight set does NOT imply external weight zero, and unknown weight
-- is not coerced to zero or a verified personal record.


-- Source 12: V2-COMPLETED-ACTIVITY-SCALAR-READ-CANDIDATE.sql [Git blob e982c2233cc8db370d72186511a65eb3de466fa0]
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
 -- Preserve raw measurements for history/export, but never project them as
 -- eligible current evidence after the canonical activity is invalidated.
 IF v_activity.status='invalidated' THEN
  RETURN pg_catalog.jsonb_build_object(
   'activityId',p_activity_id,'metrics','[]'::jsonb,
   'unresolvedMetrics','[]'::jsonb,
   'coverage','invalidated_activity');
 END IF;
 -- Evidence from all sources, including excluded/low confidence sources,
 -- is considered when determining whether a metric can be displayed.
 WITH rows AS (
  SELECT m.metric_code,m.definition_version,d.canonical_unit,
   m.value_numeric,m.value_text,m.value_boolean,m.measurement_kind,
   m.quality AS measurement_quality,s.quality AS source_quality,
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
   'canonicalUnit',g.canonical_unit,
   'measurementQuality',CASE WHEN EXISTS(
     SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
      AND r.definition_version=g.definition_version AND r.measurement_quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'sourceQuality',CASE WHEN EXISTS(
     SELECT 1 FROM rows r WHERE r.metric_code=g.metric_code
      AND r.definition_version=g.definition_version AND r.source_quality='partial'
    ) THEN 'partial' ELSE 'trusted' END,
   'quality',
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

