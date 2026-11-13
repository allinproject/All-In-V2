-- ALL-230 / ALL-232 REVIEW ONLY; extends the canonical Training restriction
-- owner, never a Coach-owned shadow preference table. NOT DEPLOYED.
-- Requires V2-TRAINING-ATHLETE-RESTRICTIONS-OWNER-REVIEW-CANDIDATE.sql.
-- No public/client EXECUTE grant until auth, privacy and staging acceptance.
-- IMPORTANT: ordinary athlete writes may not certify an unreviewed empty
-- restriction inventory. A separate trusted owner reconciliation is required.
BEGIN;
CREATE TABLE allin_private.v2_training_restriction_action_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 action_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{32}$'),
 result_revision bigint NOT NULL CHECK(result_revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,action_id)
);
ALTER TABLE allin_private.v2_training_restriction_action_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_training_restriction_action_receipts
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.v2_training_restriction_write_candidate(
 p_expected_user_id uuid,
 p_action_id uuid,
 p_action text,
 p_rule_id uuid,
 p_category text,
 p_subject text,
 p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path='' AS $writer$
DECLARE
 v_user uuid:=auth.uid();
 v_claim text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session uuid;
 v_current bigint:=0;
 v_cert_digest text;
 v_certified_at timestamptz;
 v_next bigint;
 v_hash text;
 v_existing allin_private.v2_training_restriction_action_receipts%ROWTYPE;
 v_rule public.v2_training_athlete_restrictions%ROWTYPE;
BEGIN
 IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user OR
    p_action_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR
    p_action NOT IN ('certify_empty','activate','retire') OR p_action IS NULL THEN
  RAISE EXCEPTION 'Invalid restriction owner/action' USING ERRCODE='42501'; END IF;
 IF v_claim IS NULL OR v_claim='' THEN
  RAISE EXCEPTION 'Current athlete session required' USING ERRCODE='42501'; END IF;
 BEGIN v_session:=v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Malformed athlete session' USING ERRCODE='42501'; END;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_user)
 OR NOT EXISTS(SELECT 1 FROM auth.sessions
  WHERE id=v_session AND user_id=v_user
   AND (not_after IS NULL OR not_after>pg_catalog.clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=v_user) THEN
  RAISE EXCEPTION 'Active athlete account/session required' USING ERRCODE='42501'; END IF;
 -- Keep action IDs scoped to the exact requested intent. The hash is only
 -- an idempotency guard, not an authentication or authorization credential.
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_array(
   p_expected_user_id,p_action,p_rule_id,p_category,p_subject,p_expected_revision)::text);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-training-restrictions:'||v_user::text,0));
 SELECT * INTO v_existing FROM allin_private.v2_training_restriction_action_receipts
 WHERE user_id=v_user AND action_id=p_action_id;
 IF FOUND THEN
  IF v_existing.request_hash<>v_hash THEN
   RAISE EXCEPTION 'Conflicting restriction action replay' USING ERRCODE='23505'; END IF;
  -- An action receipt may survive a partial backup/restore while its owner
  -- certification is absent or stale. It cannot independently authorize a
  -- success reply or certify the full imported restriction inventory.
  SELECT certified_revision INTO v_current
  FROM allin_private.v2_training_restriction_certifications
  WHERE user_id=v_user FOR UPDATE;
  IF v_current IS NULL OR v_current<v_existing.result_revision OR
    NOT EXISTS(SELECT 1 FROM allin_private.v2_training_restriction_certifications c
      WHERE c.user_id=v_user AND
      c.inventory_digest=
        allin_private.v2_training_restriction_inventory_digest_candidate(v_user)
      AND c.certified_at<=pg_catalog.clock_timestamp()) OR
    EXISTS(SELECT 1 FROM public.v2_training_athlete_restrictions r
      JOIN allin_private.v2_training_restriction_certifications c
       ON c.user_id=r.user_id
      WHERE r.user_id=v_user AND
       (r.revision>c.certified_revision OR r.updated_at>c.certified_at)) THEN
   RAISE EXCEPTION 'Restriction receipt lacks current owner certification'
    USING ERRCODE='42501'; END IF;
  RETURN pg_catalog.jsonb_build_object('ownerId',v_user,
   'certifiedRevision',v_existing.result_revision,'replayed',true);
 END IF;
 SELECT certified_revision,inventory_digest,certified_at
 INTO v_current,v_cert_digest,v_certified_at
 FROM allin_private.v2_training_restriction_certifications
 WHERE user_id=v_user FOR UPDATE;
 v_current:=coalesce(v_current,0);
 -- A first-time explicit mutation cannot certify the athlete's ENTIRE
 -- restriction inventory. The Training owner must reconcile historical and
 -- current restriction sources before issuing the first certification.
 -- Otherwise a new single restriction would conceal previously stored ones.
 IF v_current=0 THEN
  RAISE EXCEPTION 'Trusted Training inventory reconciliation required'
   USING ERRCODE='42501'; END IF;
 -- Refuse to recertify a corrupted or partially restored inventory merely
 -- because a legitimate owner is submitting a new rule change. Reconcile
 -- the full Training-owned source inventory first, outside this writer.
 IF v_certified_at IS NULL OR
    v_certified_at>pg_catalog.clock_timestamp() OR
    v_cert_digest IS DISTINCT FROM
     allin_private.v2_training_restriction_inventory_digest_candidate(v_user) OR
    EXISTS(SELECT 1 FROM public.v2_training_athlete_restrictions r
      WHERE r.user_id=v_user AND
       (r.revision>v_current OR r.updated_at>v_certified_at)) THEN
  RAISE EXCEPTION 'Restriction inventory must be reconciled before mutation'
   USING ERRCODE='40001'; END IF;
 IF p_expected_revision<>v_current THEN
  RAISE EXCEPTION 'Restriction revision changed; reload and retry'
   USING ERRCODE='40001'; END IF;
 IF p_action='certify_empty' THEN
  -- No record absence can prove that existing restrictions were imported or
  -- reviewed. Do not let a normal session self-certify an empty inventory.
  -- A separate Training-owned reconciler must record this after consent,
  -- source inventory/restore checks and release approval.
  RAISE EXCEPTION 'Trusted Training inventory reconciliation required'
   USING ERRCODE='42501';
 ELSIF p_action='activate' THEN
  IF p_rule_id IS NULL OR p_category NOT IN
    ('exercise','equipment','schedule','pain_or_return','preference') OR
    p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 3 AND 200 THEN
   RAISE EXCEPTION 'Invalid restriction activation' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_rule FROM public.v2_training_athlete_restrictions
  WHERE id=p_rule_id FOR UPDATE;
  IF FOUND THEN
   IF v_rule.user_id<>v_user OR v_rule.category<>p_category OR
      v_rule.subject<>btrim(p_subject) OR v_rule.source<>'explicit_user' THEN
    RAISE EXCEPTION 'Restriction identity mismatch' USING ERRCODE='42501'; END IF;
   IF v_rule.status='active' THEN
    RAISE EXCEPTION 'Active restriction requires a new revision action'
     USING ERRCODE='22023'; END IF;
   UPDATE public.v2_training_athlete_restrictions
    SET status='active',revision=v_current+1,updated_at=now()
    WHERE id=p_rule_id AND user_id=v_user;
  ELSE
   INSERT INTO public.v2_training_athlete_restrictions
    (id,user_id,category,subject,source,status,revision)
   VALUES(p_rule_id,v_user,p_category,btrim(p_subject),'explicit_user','active',v_current+1);
  END IF;
 ELSE
  IF p_rule_id IS NULL OR p_category IS NOT NULL OR p_subject IS NOT NULL THEN
   RAISE EXCEPTION 'Invalid restriction retirement' USING ERRCODE='22023'; END IF;
  UPDATE public.v2_training_athlete_restrictions
   SET status='retired',revision=v_current+1,updated_at=now()
   WHERE id=p_rule_id AND user_id=v_user AND status='active';
  IF NOT FOUND THEN
   RAISE EXCEPTION 'No active same-owner restriction found'
    USING ERRCODE='42501'; END IF;
 END IF;
 v_next:=v_current+1;
 INSERT INTO allin_private.v2_training_restriction_certifications
  (user_id,certified_revision,inventory_digest,certified_at)
 VALUES(v_user,v_next,
  allin_private.v2_training_restriction_inventory_digest_candidate(v_user),
  now())
 ON CONFLICT(user_id) DO UPDATE
  SET certified_revision=excluded.certified_revision,
      inventory_digest=excluded.inventory_digest,
      certified_at=excluded.certified_at;
 INSERT INTO allin_private.v2_training_restriction_action_receipts
  (user_id,action_id,request_hash,result_revision)
 VALUES(v_user,p_action_id,v_hash,v_next);
 RETURN pg_catalog.jsonb_build_object('ownerId',v_user,
  'certifiedRevision',v_next,'replayed',false);
END;$writer$;
REVOKE ALL ON FUNCTION public.v2_training_restriction_write_candidate(
 uuid,uuid,text,uuid,text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- Explicit grant deferred. No empty certification from this writer.
-- A future Training-owned review/accept action may
-- offer authenticated EXECUTE after full session, RLS, export/delete acceptance.
COMMIT;
