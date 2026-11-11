-- ALL-243 / ALL-258 REVIEW ONLY: typed performed strength sets.
-- NOT A MIGRATION. No production deployment or client GRANT.
-- Uses the same canonical Completed Activity, source, and semantic segment
-- identities. Exercise ID has NO unapproved exercise-catalog FK yet.
BEGIN;
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
COMMIT;
