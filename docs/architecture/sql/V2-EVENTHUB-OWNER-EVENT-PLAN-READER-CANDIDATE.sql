-- ALL-244 / ALL-246 REVIEW ONLY: canonical owner's event-plan evidence.
-- Requires V2-EVENTHUB-IDENTITY-MEMBERSHIP-PARTICIPATION-CANDIDATE.sql.
-- Return ONLY explicit EventParticipation records; mere URL/group membership
-- never appears as registration or Training plan evidence.
-- Event provides name/kind/date/sport; Goal owns priority. Edition and
-- Goal binding are NOT certified here. No synthetic edition identifiers.
-- PRIVATE REVIEW CANDIDATE: not an approved live RPC.
CREATE FUNCTION allin_private.v2_event_plan_owner_evidence_candidate(
 p_expected_user_id uuid,p_max_events integer DEFAULT 64
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $owner_events$
DECLARE
 v_owner uuid:=auth.uid();
 v_session uuid;
 v_claim text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_count bigint;
 v_events jsonb;
 v_version text;
BEGIN
 IF v_owner IS NULL OR p_expected_user_id IS DISTINCT FROM v_owner
   OR p_max_events IS NULL OR p_max_events<1 OR p_max_events>64
 THEN RAISE EXCEPTION 'Current EventHub owner required' USING ERRCODE='42501';
 END IF;
 BEGIN
  v_session:=v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid EventHub session' USING ERRCODE='42501';
 END;
 IF v_session IS NULL OR NOT EXISTS(
   SELECT 1 FROM auth.users WHERE id=v_owner)
   OR NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=v_owner)
   OR NOT EXISTS(SELECT 1 FROM auth.sessions
     WHERE id=v_session AND user_id=v_owner
     AND (not_after IS NULL OR not_after>pg_catalog.now()))
 THEN RAISE EXCEPTION 'EventHub session missing or revoked'
   USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO v_count
 FROM public.v2_event_participations WHERE user_id=v_owner;
 IF v_count>p_max_events THEN
  RAISE EXCEPTION 'EventHub owner event list requires pagination'
    USING ERRCODE='54000';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object(
    'eventId',e.id,'ownerId',p.user_id,'eventVersion',e.event_version,
    'name',e.name,'eventKind',e.event_kind,
    'date',e.start_local_date,'timezone',e.event_timezone,
    'sport',e.sport,'verification',e.source_verification,
    'sourceRevision',e.source_revision,
    'participation',p.state,'participationSource',p.source_kind,
    'participationVersion',p.version,'resultVerified',p.result_verified,
    'cancelled',e.cancelled
   ) ORDER BY e.start_local_date,e.id),'[]'::jsonb),
   coalesce(pg_catalog.md5(pg_catalog.string_agg(
    e.id::text||':'||e.event_version::text||':'||p.version::text||
    ':'||coalesce(e.start_local_date::text,'unknown')||':'||
    coalesce(e.source_revision,'unknown')||':'||p.state||':'||
    p.source_kind||':'||e.source_verification||':'||
    e.cancelled::text,',' ORDER BY e.id)), 'empty')
 INTO v_events,v_version
 FROM public.v2_event_participations p
 JOIN public.v2_events e ON e.id=p.event_id
 WHERE p.user_id=v_owner;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',v_owner,'complete',true,'nextCursor',null,
  'snapshotVersion',v_version,'events',v_events);
END;
$owner_events$;
REVOKE ALL ON FUNCTION allin_private.v2_event_plan_owner_evidence_candidate(
 uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
