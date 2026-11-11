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
 -- Serialize source identity within athlete account; two concurrent provider
 -- callbacks must not create two different canonical workout records.
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
