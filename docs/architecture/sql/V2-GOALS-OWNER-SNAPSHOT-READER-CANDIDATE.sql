-- ALL-239 / ALL-222 REVIEW ONLY. Private canonical Goal owner read.
-- Apply after V2-GOALS-IDENTITY-REVISION-OWNER-CANDIDATE.sql.
-- No deployment, client grant, shadow Goal history or EventHub derivation.
CREATE FUNCTION allin_private.v2_goal_owner_snapshot_candidate(
  p_expected_user_id uuid,p_max_goals integer DEFAULT 64
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $owner_read$
DECLARE
  v_user uuid:=auth.uid();
  v_sid uuid;
  v_claim text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
  v_count bigint;
  v_records jsonb;
  v_token text;
BEGIN
  IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user
    OR p_max_goals IS NULL OR p_max_goals<1 OR p_max_goals>64
  THEN RAISE EXCEPTION 'Goal owner or bounded window invalid' USING ERRCODE='42501'; END IF;
  IF v_claim IS NULL OR v_claim='' THEN
    RAISE EXCEPTION 'Current Goal session required' USING ERRCODE='42501';
  END IF;
  BEGIN
    v_sid:=v_claim::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Malformed Goal session' USING ERRCODE='42501';
  END;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_user)
     OR NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=v_user)
     OR NOT EXISTS(SELECT 1 FROM auth.sessions
       WHERE id=v_sid AND user_id=v_user
       AND (not_after IS NULL OR not_after>pg_catalog.now()))
  THEN RAISE EXCEPTION 'Goal owner session is revoked or unavailable'
    USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_count FROM public.v2_goals WHERE user_id=v_user;
  IF v_count>p_max_goals THEN
    RAISE EXCEPTION 'Goal owner snapshot requires pagination' USING ERRCODE='54000';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'goalId',g.id,'goalKind',g.goal_kind,'title',g.title,'goalStatus',g.status,
      'goalVersion',g.version,'activeRevisionId',g.active_revision_id,
      'revisionNumber',r.revision_number,'revisionStatus',r.status,
      'priorityRole',r.priority_role,'priorityOrder',r.priority_order,
      'startDate',r.start_date,'targetDate',r.target_date,
      'checkInDate',r.check_in_date,'timezone',r.timezone,
      'goalSchemaVersion',r.goal_schema_version
    ) ORDER BY g.created_at,g.id),'[]'::jsonb),
    coalesce(pg_catalog.md5(pg_catalog.string_agg(
      g.id::text||':'||g.version::text||':'||coalesce(g.active_revision_id::text,'none'),
      ',' ORDER BY g.id)),'empty')
  INTO v_records,v_token
  FROM public.v2_goals g
  LEFT JOIN public.v2_goal_revisions r
    ON r.goal_id=g.id AND r.user_id=g.user_id AND r.id=g.active_revision_id
       AND r.status='accepted'
  WHERE g.user_id=v_user;
  RETURN pg_catalog.jsonb_build_object(
    'ownerId',v_user,'complete',true,'nextCursor',null,
    'snapshotVersion',v_token,'records',v_records);
END;
$owner_read$;
REVOKE ALL ON FUNCTION allin_private.v2_goal_owner_snapshot_candidate(uuid,integer)
 FROM PUBLIC,anon,authenticated,service_role;
