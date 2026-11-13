-- ALL-239 / ALL-244 / ALL-246 REVIEW ONLY: composite authenticated Event Plan
-- evidence from the existing canonical EventHub and Goal owners.
-- Apply only in a disposable/isolated test database after BOTH private reader
-- candidates and their approved identity/link candidate tables.
-- NOT a versioned migration, not a client RPC, not Event/Goal/Training ownership.
-- Calls inside this single STABLE SQL statement share a PostgreSQL snapshot;
-- a mobile session generation is still a separate authenticated client concern.
CREATE FUNCTION allin_private.v2_event_plan_composite_owner_candidate(
  p_expected_user_id uuid,
  p_max_events integer DEFAULT 64,
  p_max_goals integer DEFAULT 64
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $composite$
DECLARE
  v_user uuid:=auth.uid();
  v_events jsonb;
  v_goals jsonb;
  v_event jsonb;
  v_goal jsonb;
  v_matching jsonb;
  v_requires_review boolean:=false;
  v_event_ids text[]:=ARRAY[]::text[];
  v_goal_ids text[]:=ARRAY[]::text[];
BEGIN
  IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user OR
     p_max_events IS NULL OR p_max_events NOT BETWEEN 1 AND 64 OR
     p_max_goals IS NULL OR p_max_goals NOT BETWEEN 1 AND 64
  THEN RAISE EXCEPTION 'Current bounded Event Plan owner required'
    USING ERRCODE='42501'; END IF;
  -- Both existing private owner readers independently verify live Auth session,
  -- profile, authenticated owner, completion and their bounded record count.
  v_events:=allin_private.v2_event_plan_owner_evidence_candidate(
    p_expected_user_id,p_max_events);
  v_goals:=allin_private.v2_goal_owner_snapshot_candidate(
    p_expected_user_id,p_max_goals);
  IF v_events->>'ownerId' IS DISTINCT FROM v_user::text OR
     v_goals->>'ownerId' IS DISTINCT FROM v_user::text OR
     v_events->'complete' IS DISTINCT FROM 'true'::jsonb OR
     v_goals->'complete' IS DISTINCT FROM 'true'::jsonb OR
     v_events->'nextCursor' IS DISTINCT FROM 'null'::jsonb OR
     v_goals->'nextCursor' IS DISTINCT FROM 'null'::jsonb OR
     pg_catalog.jsonb_typeof(v_events->'events') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_goals->'records') IS DISTINCT FROM 'array' OR
     nullif(v_events->>'snapshotVersion','') IS NULL OR
     nullif(v_goals->>'snapshotVersion','') IS NULL
  THEN RAISE EXCEPTION 'Incomplete or wrong-owner Event Plan sources'
    USING ERRCODE='42501'; END IF;

  FOR v_event IN SELECT value FROM pg_catalog.jsonb_array_elements(v_events->'events')
  LOOP
    IF v_event->>'ownerId' IS DISTINCT FROM v_user::text OR
       nullif(v_event->>'eventId','') IS NULL OR
       nullif(v_event->>'editionId','') IS NULL OR
       (v_event->>'eventId')=ANY(v_event_ids)
    THEN RAISE EXCEPTION 'Invalid or repeated Event owner evidence'
      USING ERRCODE='42501'; END IF;
    v_event_ids:=pg_catalog.array_append(v_event_ids,v_event->>'eventId');
    -- Provisional, postponed, cancelled or incomplete organizer facts stay
    -- visible only as explicit review evidence, never certified execution.
    IF v_event->>'verification' IS DISTINCT FROM 'organizer_verified' OR
       nullif(v_event->>'date','') IS NULL OR
       nullif(v_event->>'timezone','') IS NULL OR
       v_event->'cancelled' IS DISTINCT FROM 'false'::jsonb
    THEN v_requires_review:=true; END IF;
  END LOOP;

  FOR v_goal IN SELECT value FROM pg_catalog.jsonb_array_elements(v_goals->'records')
  LOOP
    IF nullif(v_goal->>'goalId','') IS NULL OR
       (v_goal->>'goalId')=ANY(v_goal_ids)
    THEN RAISE EXCEPTION 'Invalid or repeated Goal evidence'
      USING ERRCODE='42501'; END IF;
    v_goal_ids:=pg_catalog.array_append(v_goal_ids,v_goal->>'goalId');
    IF v_goal->>'eventId' IS NULL THEN
      IF v_goal->>'editionId' IS NOT NULL OR
         v_goal->>'boundEventVersion' IS NOT NULL
      THEN RAISE EXCEPTION 'Partial Goal Event link is invalid'
        USING ERRCODE='42501'; END IF;
      CONTINUE;
    END IF;
    -- Only the accepted, currently active Goal revision may bind an Event.
    IF v_goal->>'revisionStatus' IS DISTINCT FROM 'accepted' OR
       nullif(v_goal->>'activeRevisionId','') IS NULL OR
       nullif(v_goal->>'editionId','') IS NULL OR
       nullif(v_goal->>'boundEventVersion','') IS NULL OR
       v_goal->>'goalKind' IS DISTINCT FROM 'race_event'
    THEN RAISE EXCEPTION 'Goal-to-Event link is not accepted and typed'
      USING ERRCODE='42501'; END IF;
    SELECT value INTO v_matching
    FROM pg_catalog.jsonb_array_elements(v_events->'events')
    WHERE value->>'eventId'=v_goal->>'eventId';
    -- A Goal may be valid without an EventParticipation. Do not invent
    -- registration, priority or a matched event. Require explicit review.
    IF v_matching IS NULL OR
       v_matching->>'editionId' IS DISTINCT FROM v_goal->>'editionId' OR
       v_matching->>'eventVersion' IS DISTINCT FROM v_goal->>'boundEventVersion'
    THEN v_requires_review:=true; END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'ownerId',v_user,
    'complete',true,'nextCursor',null,
    'status',CASE WHEN v_requires_review THEN 'review_required'
                  ELSE 'owner_sources_complete' END,
    'eventSnapshotVersion',v_events->'snapshotVersion',
    'goalSnapshotVersion',v_goals->'snapshotVersion',
    'events',v_events->'events','goals',v_goals->'records',
    'trainingPlanApproved',false,
    'eventRegistrationInferred',false
  );
END;
$composite$;
REVOKE ALL ON FUNCTION allin_private.v2_event_plan_composite_owner_candidate(
  uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
