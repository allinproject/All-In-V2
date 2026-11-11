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
   'running','cycling','swimming','strength','hiking','rucking',
   'rowing','elliptical','stair','yoga','mobility','other')),
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
ALTER TABLE public.v2_activity_metric_values
 ADD COLUMN segment_id uuid;
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
