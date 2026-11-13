-- ALL-230 / ALL-232 / ALL-246 REVIEW ONLY. Not a production migration.
-- Training owns the explicit durable athlete restriction lifecycle. Coach reads
-- this owner contract and cannot write, approve, or infer restrictions from chat.
-- Deploy only after Training writer, owner export/deletion, consent and Auth
-- review. A missing owner certification is NOT a verified empty rule set.
BEGIN;
CREATE TABLE public.v2_training_athlete_restrictions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN
  ('exercise','equipment','schedule','pain_or_return','preference')),
 subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 3 AND 200),
 source text NOT NULL CHECK(source IN
  ('explicit_user','approved_plan','system_inferred')),
 status text NOT NULL CHECK(status IN ('active','retired')),
 source_ref text,
 revision bigint NOT NULL CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_ref IS NULL OR length(btrim(source_ref)) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX v2_training_one_active_named_restriction
 ON public.v2_training_athlete_restrictions(user_id,category,lower(btrim(subject)))
 WHERE status='active';
CREATE INDEX v2_training_restrictions_owner_status
 ON public.v2_training_athlete_restrictions(user_id,status);
-- Written by the canonical Training owner only after it has reconciled the
-- athlete's current rules. This prevents an uninitialized account appearing
-- to have zero restrictions. An ordinary blank table cannot certify itself.
CREATE TABLE allin_private.v2_training_restriction_certifications (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 certified_revision bigint NOT NULL CHECK(certified_revision>=1),
 -- Snapshot checksum of all active AND retired owner rules. Detects an
 -- incomplete restore or a backdated edit that revision/timestamp miss.
 inventory_digest text NOT NULL CHECK(length(inventory_digest)=32 AND inventory_digest ~ '^[0-9a-f]+$'),
 certified_at timestamptz NOT NULL DEFAULT now(),
 CHECK(certified_at<=now())
);
-- Canonical Training owner checksum, used by the same existing
-- certification row. This is an accidental-corruption/restore consistency
-- guard, NOT an independently signed evidence of source completeness.
CREATE FUNCTION allin_private.v2_training_restriction_inventory_digest_candidate(
 p_owner uuid
) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $digest$
 SELECT pg_catalog.md5(coalesce((
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)
   ORDER BY r.id)::text
  FROM public.v2_training_athlete_restrictions r
  WHERE r.user_id=p_owner
 ),'[]'))
$digest$;
REVOKE ALL ON FUNCTION
 allin_private.v2_training_restriction_inventory_digest_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.v2_training_athlete_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_training_restriction_certifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_training_athlete_restrictions
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_training_restriction_certifications
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.v2_training_active_restrictions_read_candidate(
 p_expected_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path='' AS $read$
DECLARE
 v_user uuid:=auth.uid();
 v_claim text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session uuid;
 v_cert bigint;
 v_cert_digest text;
 v_certified_at timestamptz;
 v_restrictions jsonb;
BEGIN
 IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user THEN
  RAISE EXCEPTION 'Training restriction owner mismatch' USING ERRCODE='42501'; END IF;
 IF v_claim IS NULL OR v_claim='' THEN
  RAISE EXCEPTION 'Training restrictions require Auth session' USING ERRCODE='42501'; END IF;
 BEGIN v_session:=v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Malformed Auth session' USING ERRCODE='42501'; END;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_user)
 OR NOT EXISTS(SELECT 1 FROM auth.sessions s
   WHERE s.id=v_session AND s.user_id=v_user
     AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.v2_profiles p WHERE p.user_id=v_user) THEN
  RAISE EXCEPTION 'Invalid active athlete account/session' USING ERRCODE='42501'; END IF;
 SELECT c.certified_revision,c.inventory_digest,c.certified_at
 INTO v_cert,v_cert_digest,v_certified_at
 FROM allin_private.v2_training_restriction_certifications c
 WHERE c.user_id=v_user;
 IF v_cert IS NULL THEN
  RAISE EXCEPTION 'Training restriction inventory not certified'
   USING ERRCODE='42501'; END IF;
 -- A revision number alone is insufficient: a privileged unreviewed
 -- UPDATE could keep the old revision while changing the forbidden movement.
 -- Certification must postdate every recorded rule mutation, with a bounded
 -- clock. Normal Training writer updates certification AFTER its rule change.
 IF v_certified_at IS NULL OR v_certified_at>pg_catalog.clock_timestamp() OR
    v_cert_digest IS DISTINCT FROM
      allin_private.v2_training_restriction_inventory_digest_candidate(v_user) OR
    EXISTS(SELECT 1 FROM public.v2_training_athlete_restrictions r
      WHERE r.user_id=v_user AND
        (r.revision>v_cert OR r.updated_at>v_certified_at)) THEN
  RAISE EXCEPTION 'Training restriction certification stale'
   USING ERRCODE='40001'; END IF;
 WITH selected AS (
  SELECT id,category,subject,source,status,updated_at
  FROM public.v2_training_athlete_restrictions
  WHERE user_id=v_user AND status='active'
  ORDER BY updated_at DESC,id LIMIT 201
 ) SELECT coalesce(pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_object('id',id,'category',category,
   'subject',subject,'source',source,'status',status,
   'updatedAt',updated_at)
  ORDER BY updated_at DESC,id),'[]'::jsonb) INTO v_restrictions FROM selected;
 IF pg_catalog.jsonb_array_length(v_restrictions)>200 THEN
  RAISE EXCEPTION 'Training restrictions exceed bounded read' USING ERRCODE='54000'; END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',v_user,'verified',true,
  'certifiedRevision',v_cert,'restrictions',v_restrictions);
END;$read$;
REVOKE ALL ON FUNCTION public.v2_training_active_restrictions_read_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- A later reviewed Auth-owner migration explicitly grants authenticated
-- EXECUTE. There are deliberately NO app grants in this candidate.
COMMIT;
),
 certified_at timestamptz NOT NULL DEFAULT now(),
 CHECK(certified_at<=now())
);
ALTER TABLE public.v2_training_athlete_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_training_restriction_certifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_training_athlete_restrictions
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_training_restriction_certifications
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.v2_training_active_restrictions_read_candidate(
 p_expected_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path='' AS $read$
DECLARE
 v_user uuid:=auth.uid();
 v_claim text:=pg_catalog.current_setting('request.jwt.claim.session_id',true);
 v_session uuid;
 v_cert bigint;
 v_certified_at timestamptz;
 v_restrictions jsonb;
BEGIN
 IF v_user IS NULL OR p_expected_user_id IS DISTINCT FROM v_user THEN
  RAISE EXCEPTION 'Training restriction owner mismatch' USING ERRCODE='42501'; END IF;
 IF v_claim IS NULL OR v_claim='' THEN
  RAISE EXCEPTION 'Training restrictions require Auth session' USING ERRCODE='42501'; END IF;
 BEGIN v_session:=v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Malformed Auth session' USING ERRCODE='42501'; END;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_user)
 OR NOT EXISTS(SELECT 1 FROM auth.sessions s
   WHERE s.id=v_session AND s.user_id=v_user
     AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.v2_profiles p WHERE p.user_id=v_user) THEN
  RAISE EXCEPTION 'Invalid active athlete account/session' USING ERRCODE='42501'; END IF;
 SELECT c.certified_revision,c.certified_at INTO v_cert,v_certified_at
 FROM allin_private.v2_training_restriction_certifications c
 WHERE c.user_id=v_user;
 IF v_cert IS NULL THEN
  RAISE EXCEPTION 'Training restriction inventory not certified'
   USING ERRCODE='42501'; END IF;
 -- A revision number alone is insufficient: a privileged unreviewed
 -- UPDATE could keep the old revision while changing the forbidden movement.
 -- Certification must postdate every recorded rule mutation, with a bounded
 -- clock. Normal Training writer updates certification AFTER its rule change.
 IF v_certified_at IS NULL OR v_certified_at>pg_catalog.clock_timestamp() OR
    EXISTS(SELECT 1 FROM public.v2_training_athlete_restrictions r
      WHERE r.user_id=v_user AND
        (r.revision>v_cert OR r.updated_at>v_certified_at)) THEN
  RAISE EXCEPTION 'Training restriction certification stale'
   USING ERRCODE='40001'; END IF;
 WITH selected AS (
  SELECT id,category,subject,source,status,updated_at
  FROM public.v2_training_athlete_restrictions
  WHERE user_id=v_user AND status='active'
  ORDER BY updated_at DESC,id LIMIT 201
 ) SELECT coalesce(pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_object('id',id,'category',category,
   'subject',subject,'source',source,'status',status,
   'updatedAt',updated_at)
  ORDER BY updated_at DESC,id),'[]'::jsonb) INTO v_restrictions FROM selected;
 IF pg_catalog.jsonb_array_length(v_restrictions)>200 THEN
  RAISE EXCEPTION 'Training restrictions exceed bounded read' USING ERRCODE='54000'; END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',v_user,'verified',true,
  'certifiedRevision',v_cert,'restrictions',v_restrictions);
END;$read$;
REVOKE ALL ON FUNCTION public.v2_training_active_restrictions_read_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- A later reviewed Auth-owner migration explicitly grants authenticated
-- EXECUTE. There are deliberately NO app grants in this candidate.
COMMIT;
