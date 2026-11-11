-- ALL-246 / ALL-222 REVIEW-ONLY authenticated owner gateway for Training actions.
-- NOT A MIGRATION. No live grants or deployment authorized.
-- Uses existing V2 auth.uid / auth.users / v2_profiles identity. It delegates to
-- exactly ONE owner writer; no extra workout/session store.
-- This proposal deliberately requires an existing auth.sessions row; the
-- session_id claim must be issued by trusted Supabase Auth, never user metadata.
CREATE FUNCTION public.v2_training_session_action_candidate(
 p_expected_user_id uuid,p_session_id uuid,p_action_id uuid,p_command text,
 p_expected_version bigint,p_request_fingerprint text,
 p_local_date date,p_timezone text,p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $owner_action$
DECLARE
 v_uid uuid := auth.uid();
 v_session_claim text := pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session_id uuid;
BEGIN
 IF v_uid IS NULL OR p_expected_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Expected owner does not match authenticated account'
      USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=v_uid)
    OR NOT EXISTS (SELECT 1 FROM public.v2_profiles p WHERE p.user_id=v_uid)
 THEN RAISE EXCEPTION 'Active V2 account required' USING ERRCODE='42501'; END IF;
 -- Fail closed on missing/malformed session_id rather than silently trusting
 -- a stale Auth JWT after account/session revocation.
 IF v_session_claim IS NULL OR v_session_claim='' THEN
   RAISE EXCEPTION 'Active authenticated session required' USING ERRCODE='42501';
 END IF;
 BEGIN
   v_session_id:=v_session_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'Invalid authenticated session identifier' USING ERRCODE='42501';
 END;
 IF NOT EXISTS (SELECT 1 FROM auth.sessions s
    WHERE s.id=v_session_id AND s.user_id=v_uid) THEN
   RAISE EXCEPTION 'Authenticated session expired or revoked' USING ERRCODE='42501';
 END IF;
 IF p_expected_version IS NULL OR p_expected_version<0 THEN
   RAISE EXCEPTION 'Expected session version is required' USING ERRCODE='22023';
 END IF;
 -- Trusted server identity from auth.uid(), never accept the client-provided
 -- owner as authority or let a malicious user call the private helper.
 RETURN allin_private.v2_training_apply_session_candidate(
   v_uid,p_session_id,p_action_id,p_command,p_expected_version,
   p_request_fingerprint,p_local_date,p_timezone,p_occurred_at
 );
END;
$owner_action$;
REVOKE ALL ON FUNCTION public.v2_training_session_action_candidate(
 uuid,uuid,uuid,text,bigint,text,date,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
-- Explicit review gate: the final migration must separately approve
-- GRANT EXECUTE TO authenticated after real-session & two-user replay.
-- This file intentionally contains NO execute grant.
