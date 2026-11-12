-- ALL-239 / ALL-222 REVIEW ONLY. Canonical behavior children of a Goal revision.
-- NOT a migration. No second habit/Training/Food Log event history is created.
-- Apply after V2-GOALS-IDENTITY-REVISION-OWNER-CANDIDATE.sql.
CREATE TABLE public.v2_goal_revision_behavior_targets (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 goal_id uuid NOT NULL,
 goal_revision_id uuid NOT NULL,
 behavior_code text CHECK(
   behavior_code IS NULL OR length(btrim(behavior_code)) BETWEEN 1 AND 80),
 behavior_description text NOT NULL
   CHECK(length(btrim(behavior_description)) BETWEEN 1 AND 500),
 cadence_kind text CHECK(cadence_kind IN
  ('daily','weekly','count_per_period','event_based','qualitative_no_fixed_cadence')),
 target_frequency numeric CHECK(
   target_frequency IS NULL OR target_frequency>0 AND target_frequency<=1000),
 frequency_period text CHECK(frequency_period IN ('day','week','month')),
 evidence_owner text CHECK(evidence_owner IN
   ('training','food_log','meal_prep','user_check_in')),
 evidence_policy text NOT NULL DEFAULT 'no_tracking'
   CHECK(evidence_policy IN ('user_check_in','canonical_activity',
      'canonical_food_or_meal_prep','mixed','no_tracking')),
 user_confirmed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(goal_revision_id,goal_id,user_id)
  REFERENCES public.v2_goal_revisions(id,goal_id,user_id) ON DELETE CASCADE,
 CONSTRAINT v2_goal_behavior_cadence_consistency CHECK(
  (cadence_kind='count_per_period' AND target_frequency IS NOT NULL
   AND frequency_period IS NOT NULL)
  OR (cadence_kind IN ('event_based','qualitative_no_fixed_cadence')
      AND target_frequency IS NULL AND frequency_period IS NULL)
  OR (cadence_kind IN ('daily','weekly')
      AND ((target_frequency IS NULL AND frequency_period IS NULL)
        OR (target_frequency IS NOT NULL AND frequency_period IS NOT NULL)))
  OR (cadence_kind IS NULL AND target_frequency IS NULL AND frequency_period IS NULL)
 ),
 CONSTRAINT v2_goal_behavior_no_tracking_requires_no_owner CHECK(
  evidence_policy<>'no_tracking' OR evidence_owner IS NULL)
);
CREATE INDEX v2_goal_behavior_by_revision
 ON public.v2_goal_revision_behavior_targets(user_id,goal_revision_id);

-- The parent's historical published intent owns these children. Only
-- candidate revision children may change; Auth teardown is allowed to purge.
CREATE FUNCTION allin_private.v2_goal_behavior_history_guard_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
DECLARE
 parent_status text;
 owner_alive boolean;
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT status INTO parent_status FROM public.v2_goal_revisions
   WHERE id=NEW.goal_revision_id AND goal_id=NEW.goal_id AND user_id=NEW.user_id;
   IF parent_status IS DISTINCT FROM 'candidate' THEN
     RAISE EXCEPTION 'Behavior target requires editable Goal candidate'
       USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 SELECT status INTO parent_status FROM public.v2_goal_revisions
 WHERE id=OLD.goal_revision_id AND goal_id=OLD.goal_id AND user_id=OLD.user_id;
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) INTO owner_alive;
 IF owner_alive AND (parent_status IS DISTINCT FROM 'candidate'
    OR TG_OP='UPDATE' AND (
      NEW.user_id IS DISTINCT FROM OLD.user_id OR
      NEW.goal_id IS DISTINCT FROM OLD.goal_id OR
      NEW.goal_revision_id IS DISTINCT FROM OLD.goal_revision_id)) THEN
   RAISE EXCEPTION 'Published Goal behavior is immutable or owner reassignment denied'
     USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER v2_goal_behavior_history_guard
 BEFORE INSERT OR UPDATE OR DELETE ON public.v2_goal_revision_behavior_targets
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_goal_behavior_history_guard_candidate();

-- A Goal may be accepted with no behavior targets, but a present behavior
-- must reflect explicit athlete confirmation, never silent Coach activation.
CREATE FUNCTION allin_private.v2_goal_behavior_approval_guard_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $approve$
BEGIN
 IF OLD.status='candidate' AND NEW.status='accepted'
    AND EXISTS(
      SELECT 1 FROM public.v2_goal_revision_behavior_targets b
      WHERE b.goal_revision_id=NEW.id AND b.goal_id=NEW.goal_id
        AND b.user_id=NEW.user_id AND b.user_confirmed IS NOT TRUE
    )
 THEN RAISE EXCEPTION 'All Goal behaviors require athlete confirmation before acceptance'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$approve$;
CREATE TRIGGER v2_goal_behavior_approval_guard
 BEFORE UPDATE OF status ON public.v2_goal_revisions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_goal_behavior_approval_guard_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_goal_behavior_approval_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.v2_goal_revision_behavior_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_goal_revision_behavior_targets
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION allin_private.v2_goal_behavior_history_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
