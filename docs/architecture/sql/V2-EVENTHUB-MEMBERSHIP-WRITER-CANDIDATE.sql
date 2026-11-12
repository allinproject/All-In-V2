-- ALL-244 REVIEW ONLY. Canonical EventHub group membership transitions,
-- NOT registration, EventPlan acceptance, new social post or a deployed RPC.
-- Apply after V2-EVENTHUB-IDENTITY-MEMBERSHIP-PARTICIPATION-CANDIDATE.
BEGIN;
CREATE TABLE allin_private.v2_event_group_actions (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 action_id uuid NOT NULL,
 event_id uuid NOT NULL,
 group_id uuid NOT NULL,
 reviewed_alias_id uuid,
 action_kind text NOT NULL CHECK(action_kind IN
  ('join','leave','show_participation','hide_participation')),
 expected_version bigint NOT NULL CHECK(expected_version>=1),
 result_version bigint NOT NULL CHECK(result_version=expected_version+1),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,action_id),
 FOREIGN KEY(group_id,event_id)
  REFERENCES public.v2_event_groups(id,event_id) ON DELETE CASCADE
);
ALTER TABLE allin_private.v2_event_group_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_event_group_actions
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_event_group_action_candidate(
 p_user_id uuid,p_session_id uuid,p_event_id uuid,p_group_id uuid,
 p_action_id uuid,p_reviewed_alias_id uuid,p_action_kind text,
 p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $member$
DECLARE
 g public.v2_event_groups%ROWTYPE;
 existing public.v2_event_group_memberships%ROWTYPE;
 prior allin_private.v2_event_group_actions%ROWTYPE;
 result_version bigint;
 stamp timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF pg_catalog.current_setting('role',true) NOT IN
  ('postgres','service_role','none')
 THEN RAISE EXCEPTION 'Trusted EventHub owner required'
    USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL OR p_session_id IS NULL
  OR p_event_id IS NULL OR p_group_id IS NULL OR p_action_id IS NULL
  OR p_expected_version IS NULL OR p_expected_version<1
  OR p_action_kind NOT IN
    ('join','leave','show_participation','hide_participation')
 THEN RAISE EXCEPTION 'Malformed EventHub group action'
    USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM auth.sessions
  WHERE id=p_session_id AND user_id=p_user_id
    AND (not_after IS NULL OR not_after>stamp)
  FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id)
 THEN RAISE EXCEPTION 'Active EventHub athlete session required'
    USING ERRCODE='42501'; END IF;
 -- Serialize the same athlete/group even before its first membership row.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_user_id::text||':'||p_group_id::text,0));
 SELECT * INTO g FROM public.v2_event_groups
  WHERE id=p_group_id AND event_id=p_event_id
  FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical EventHub group mismatch'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM allin_private.v2_event_group_actions
  WHERE user_id=p_user_id AND action_id=p_action_id;
 IF FOUND THEN
  IF prior.session_id IS DISTINCT FROM p_session_id
   OR prior.event_id IS DISTINCT FROM p_event_id
   OR prior.group_id IS DISTINCT FROM p_group_id
   OR prior.reviewed_alias_id IS DISTINCT FROM p_reviewed_alias_id
   OR prior.action_kind IS DISTINCT FROM p_action_kind
   OR prior.expected_version IS DISTINCT FROM p_expected_version
  THEN RAISE EXCEPTION 'EventHub action ID reused with a different payload'
    USING ERRCODE='23505'; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'actorId',p_user_id,'eventId',p_event_id,'groupId',p_group_id,
    'action',p_action_kind,'actionId',p_action_id,'version',prior.result_version,
    'accepted',true,'replayed',true);
 END IF;
 SELECT * INTO existing FROM public.v2_event_group_memberships
  WHERE user_id=p_user_id AND event_id=p_event_id AND group_id=p_group_id
  FOR UPDATE;
 IF NOT FOUND THEN
  IF p_action_kind<>'join' OR p_expected_version<>1
   THEN RAISE EXCEPTION 'EventHub membership action requires joined state'
     USING ERRCODE='40001'; END IF;
 ELSE
  IF existing.version<>p_expected_version
  THEN RAISE EXCEPTION 'EventHub membership version changed'
    USING ERRCODE='40001'; END IF;
 END IF;
 IF p_action_kind='join' THEN
  IF g.state<>'active' OR p_reviewed_alias_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.v2_event_url_aliases a
    WHERE a.id=p_reviewed_alias_id AND a.event_id=p_event_id
      AND a.source_checked_at IS NOT NULL
      AND a.evidence_kind IN ('organizer_verified','redirect_reviewed')
  ) THEN RAISE EXCEPTION 'Explicit verified EventHub URL resolution required'
    USING ERRCODE='42501'; END IF;
  IF existing.state='joined' THEN
    RAISE EXCEPTION 'Already joined; no second EventHub membership'
      USING ERRCODE='40001'; END IF;
  result_version:=p_expected_version+1;
  IF existing.user_id IS NULL THEN
    INSERT INTO public.v2_event_group_memberships(
     user_id,event_id,group_id,state,joined_at,participant_visible,version)
    VALUES(p_user_id,p_event_id,p_group_id,'joined',stamp,false,result_version);
  ELSE
    UPDATE public.v2_event_group_memberships SET
      state='joined',joined_at=stamp,participant_visible=false,
      version=result_version
    WHERE user_id=p_user_id AND group_id=p_group_id;
  END IF;
 ELSE
  IF existing.user_id IS NULL OR existing.state<>'joined'
  THEN RAISE EXCEPTION 'EventHub action requires joined membership'
    USING ERRCODE='40001'; END IF;
  result_version:=p_expected_version+1;
  IF p_action_kind='leave' THEN
   UPDATE public.v2_event_group_memberships SET
    state='left',joined_at=null,participant_visible=false,
    version=result_version
   WHERE user_id=p_user_id AND group_id=p_group_id;
  ELSIF p_action_kind='show_participation' THEN
   IF existing.participant_visible THEN
    RAISE EXCEPTION 'EventHub participation already shown'
      USING ERRCODE='40001'; END IF;
   UPDATE public.v2_event_group_memberships SET
    participant_visible=true,version=result_version
   WHERE user_id=p_user_id AND group_id=p_group_id;
  ELSE
   IF NOT existing.participant_visible THEN
    RAISE EXCEPTION 'EventHub participation already hidden'
      USING ERRCODE='40001'; END IF;
   UPDATE public.v2_event_group_memberships SET
    participant_visible=false,version=result_version
   WHERE user_id=p_user_id AND group_id=p_group_id;
  END IF;
 END IF;
 INSERT INTO allin_private.v2_event_group_actions(
  user_id,session_id,action_id,event_id,group_id,reviewed_alias_id,
  action_kind,expected_version,result_version
 ) VALUES(p_user_id,p_session_id,p_action_id,p_event_id,p_group_id,
  p_reviewed_alias_id,p_action_kind,p_expected_version,result_version);
 RETURN pg_catalog.jsonb_build_object(
   'actorId',p_user_id,'eventId',p_event_id,'groupId',p_group_id,
   'action',p_action_kind,'actionId',p_action_id,'version',result_version,
   'accepted',true,'replayed',false);
END;
$member$;
REVOKE ALL ON FUNCTION allin_private.v2_event_group_action_candidate(
 uuid,uuid,uuid,uuid,uuid,uuid,text,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
