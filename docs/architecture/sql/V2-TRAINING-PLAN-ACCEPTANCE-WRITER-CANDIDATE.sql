-- ALL-246 / ALL-222 REVIEW ONLY: serialized canonical Training plan acceptance.
-- Not a migration or deployed client RPC. No direct app EXECUTE grants.
-- Uses the existing immutable revision/slot/day/session owner candidate.
CREATE TABLE allin_private.v2_training_plan_accept_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 action_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 expected_plan_version bigint NOT NULL CHECK(expected_plan_version>=1),
 result_version bigint NOT NULL CHECK(result_version>expected_plan_version),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,action_id),
 FOREIGN KEY(plan_id,user_id) REFERENCES public.v2_training_plans(id,user_id),
 FOREIGN KEY(revision_id,plan_id,user_id)
  REFERENCES public.v2_training_plan_revisions(id,plan_id,user_id)
);
ALTER TABLE allin_private.v2_training_plan_accept_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_training_plan_accept_receipts
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_training_accept_plan_revision_candidate(
 p_user_id uuid,p_plan_id uuid,p_revision_id uuid,p_action_id uuid,
 p_expected_plan_version bigint
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $accept$
DECLARE
 v_plan public.v2_training_plans%ROWTYPE;
 v_revision public.v2_training_plan_revisions%ROWTYPE;
 v_receipt allin_private.v2_training_plan_accept_receipts%ROWTYPE;
 v_next_version bigint;
 v_first_day date;
 v_last_day date;
 v_day_count bigint;
BEGIN
 IF p_user_id IS NULL OR p_plan_id IS NULL OR p_revision_id IS NULL
    OR p_action_id IS NULL OR p_expected_plan_version IS NULL
    OR p_expected_plan_version<1 THEN
    RAISE EXCEPTION 'Invalid plan acceptance request' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-plan:'||p_user_id::text,0));
 SELECT * INTO v_receipt FROM allin_private.v2_training_plan_accept_receipts
   WHERE user_id=p_user_id AND action_id=p_action_id;
 IF FOUND THEN
   IF v_receipt.plan_id<>p_plan_id OR v_receipt.revision_id<>p_revision_id OR
      v_receipt.expected_plan_version<>p_expected_plan_version THEN
     RAISE EXCEPTION 'Conflicting plan acceptance replay' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('planId',p_plan_id,
      'revisionId',p_revision_id,'version',v_receipt.result_version,'replayed',true);
 END IF;
 SELECT * INTO v_plan FROM public.v2_training_plans
   WHERE id=p_plan_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan owner mismatch' USING ERRCODE='42501'; END IF;
 IF v_plan.status IN ('archived','completed') THEN
    RAISE EXCEPTION 'Terminal plan cannot be changed' USING ERRCODE='22023'; END IF;
 IF v_plan.version<>p_expected_plan_version THEN
    RAISE EXCEPTION 'Plan version changed, reload before acceptance' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_revision FROM public.v2_training_plan_revisions
   WHERE id=p_revision_id AND plan_id=p_plan_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR v_revision.status<>'candidate' THEN
    RAISE EXCEPTION 'Only same-owner candidate revision can be accepted'
     USING ERRCODE='22023'; END IF;
 -- A calendar revision may consist of explicitly planned rest/unavailable days,
 -- but it cannot be an empty AI-generated shell.
 IF NOT EXISTS(SELECT 1 FROM public.v2_training_revision_days
    WHERE plan_revision_id=p_revision_id AND plan_id=p_plan_id AND user_id=p_user_id)
 THEN RAISE EXCEPTION 'Cannot accept a revision without explicit day state'
     USING ERRCODE='22023'; END IF;
 -- Explicit revision days must cover every date BETWEEN the earliest
 -- and latest submitted day. The table's unique(revision_id,date) makes
 -- count equal to span length iff there is no missing interior day.
 -- This does not establish the athlete-selected plan START or goal/race END:
 -- authoritative boundaries must be checked by the later accepted owner
 -- contract before this candidate can be deployed.
 SELECT min(athlete_local_date),max(athlete_local_date),count(*)
 INTO v_first_day,v_last_day,v_day_count
 FROM public.v2_training_revision_days
 WHERE plan_revision_id=p_revision_id AND plan_id=p_plan_id
   AND user_id=p_user_id;
 IF v_first_day IS NULL OR v_last_day IS NULL
    OR v_day_count<>(v_last_day-v_first_day+1)::bigint THEN
   RAISE EXCEPTION 'Candidate calendar has missing dates between explicit plan days'
     USING ERRCODE='22023';
 END IF;
 -- A candidate calendar cannot schedule a workout on a declared rest or
 -- unavailable day. Also reject timezone drift between the canonical day and
 -- its session; otherwise Today and activity date projections can disagree.
 IF EXISTS (
   SELECT 1 FROM public.v2_training_revision_sessions s
   JOIN public.v2_training_revision_days d
     ON d.plan_revision_id=s.plan_revision_id
       AND d.athlete_local_date=s.athlete_local_date
   WHERE s.plan_revision_id=p_revision_id
     AND s.plan_id=p_plan_id AND s.user_id=p_user_id
     AND (d.day_state IN ('rest','unavailable')
          OR d.timezone IS DISTINCT FROM s.timezone)
 ) THEN
   RAISE EXCEPTION 'Candidate calendar contradicts scheduled workout day'
     USING ERRCODE='22023';
 END IF;
 -- Existing active prescription is preserved, only status becomes superseded.
 UPDATE public.v2_training_plan_revisions
  SET status='superseded'
  WHERE id=v_plan.active_revision_id AND plan_id=p_plan_id
    AND user_id=p_user_id AND status='accepted';
 UPDATE public.v2_training_plan_revisions
  SET status='accepted',accepted_at=now(),reviewed_at=now()
  WHERE id=p_revision_id AND plan_id=p_plan_id AND user_id=p_user_id AND status='candidate';
 IF NOT FOUND THEN RAISE EXCEPTION 'Candidate revision changed' USING ERRCODE='40001'; END IF;
 v_next_version:=v_plan.version+1;
 UPDATE public.v2_training_plans
  SET active_revision_id=p_revision_id,status='active',
      version=v_next_version,updated_at=now()
  WHERE id=p_plan_id AND user_id=p_user_id AND version=p_expected_plan_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan acceptance race' USING ERRCODE='40001'; END IF;
 INSERT INTO allin_private.v2_training_plan_accept_receipts
   (user_id,action_id,plan_id,revision_id,expected_plan_version,result_version)
 VALUES(p_user_id,p_action_id,p_plan_id,p_revision_id,p_expected_plan_version,v_next_version);
 RETURN pg_catalog.jsonb_build_object('planId',p_plan_id,
    'revisionId',p_revision_id,'version',v_next_version,'replayed',false);
END;
$accept$;
REVOKE ALL ON FUNCTION allin_private.v2_training_accept_plan_revision_candidate(
 uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- The final authenticated owner API must verify actual account + auth.sessions,
-- expected version, and explicit athlete acceptance before calling this helper.
-- Immutability enforcement for approved revision children still requires a
-- service-owned mutation trigger/policy before production migration.
