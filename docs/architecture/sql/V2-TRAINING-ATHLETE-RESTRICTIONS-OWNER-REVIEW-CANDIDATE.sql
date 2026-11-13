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
-- Evidence inventory candidate for a future *trusted* first-certification reconciler.
-- It cannot certify or confer write authority. No user/client/API grants and
-- no routine is provided here to insert evidence or approve a certification.
-- A trusted, approved importer must verify source provenance independently.
CREATE TABLE allin_private.v2_training_restriction_source_evidence (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 snapshot_version text NOT NULL CHECK(length(btrim(snapshot_version)) BETWEEN 1 AND 160),
 source_kind text NOT NULL CHECK(source_kind IN
  ('current_restrictions','approved_plans','historical_records',
   'imported_records','restored_records')),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 1 AND 200),
 source_digest text NOT NULL CHECK(source_digest ~ '^[0-9a-f]{64}$'),
 -- A trusted recorder must bind every source row to the exact full canonical
 -- Training inventory (including retired records) observed at review time.
 canonical_inventory_digest text NOT NULL
  CHECK(canonical_inventory_digest ~ '^[0-9a-f]{32}$'),
 inspected_count bigint NOT NULL CHECK(inspected_count>=0),
 reconciled_count bigint NOT NULL CHECK(reconciled_count>=0),
 unresolved_count bigint NOT NULL CHECK(unresolved_count>=0),
 complete boolean NOT NULL CHECK(complete=true),
 next_cursor text CHECK(next_cursor IS NULL),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,snapshot_version,source_kind),
 UNIQUE(user_id,snapshot_version,evidence_ref),
 CHECK(inspected_count=reconciled_count AND unresolved_count=0)
);
ALTER TABLE allin_private.v2_training_restriction_source_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_training_restriction_source_evidence
 FROM PUBLIC,anon,authenticated,service_role;

-- Strictly diagnostic: source shapes are checked in the database, but only
-- future independently reviewed producer verification can establish origin.
-- No certification or DB mutation, even if all five rows appear valid.
CREATE FUNCTION allin_private.v2_training_restriction_source_coverage_review(
 p_owner uuid,p_snapshot_version text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
 SET search_path='' AS $coverage$
DECLARE v_count bigint; v_digest text; v_bound_digest text; v_digest_variants bigint;
BEGIN
 IF p_owner IS NULL OR p_snapshot_version IS NULL OR
    length(btrim(p_snapshot_version)) NOT BETWEEN 1 AND 160 OR
    NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner) OR
    NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=p_owner)
 THEN RAISE EXCEPTION 'Restriction source owner/snapshot missing'
  USING ERRCODE='42501'; END IF;
 SELECT count(*),count(DISTINCT e.canonical_inventory_digest),
        min(e.canonical_inventory_digest)
 INTO v_count,v_digest_variants,v_bound_digest
 FROM allin_private.v2_training_restriction_source_evidence e
 WHERE e.user_id=p_owner AND e.snapshot_version=p_snapshot_version;
 IF v_count<>5 THEN
  RAISE EXCEPTION 'Incomplete Training restriction source coverage'
   USING ERRCODE='42501'; END IF;
 v_digest:=allin_private.v2_training_restriction_inventory_digest_candidate(p_owner);
 -- Five well-formed rows alone cannot attest a stale or partially restored
 -- canonical inventory. This is consistency only, not source authenticity.
 IF v_digest_variants<>1 OR v_bound_digest IS DISTINCT FROM v_digest THEN
  RAISE EXCEPTION 'Restriction source snapshot no longer matches canonical inventory'
   USING ERRCODE='40001'; END IF;
 RETURN pg_catalog.jsonb_build_object('ownerId',p_owner,
  'snapshotVersion',p_snapshot_version,'sourceRowsReviewed',v_count,
  'recordedInventoryDigest',v_digest,'status','review_required',
  'sourceAuthenticityEstablished',false,'initialCertificationAuthorized',false);
END;$coverage$;
REVOKE ALL ON FUNCTION
 allin_private.v2_training_restriction_source_coverage_review(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- Training-only reconnaissance for a future trusted initial-inventory
-- reconciler. It reports just the canonical restriction table's current
-- contents, NOT proof that historical imports, plans or restorations were
-- fully examined. Never use its counters to authorize a first certificate.
-- No client/service EXECUTE and no SECURITY DEFINER authority.
CREATE FUNCTION allin_private.v2_training_restriction_reconciliation_status_candidate(
 p_owner uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
 SET search_path='' AS $status$
DECLARE
 v_total bigint;
 v_active bigint;
 v_retired bigint;
 v_by_source jsonb;
 v_cert_revision bigint;
 v_cert_digest text;
 v_certified_at timestamptz;
 v_current_digest text;
 v_cert_matches boolean:=false;
BEGIN
 IF p_owner IS NULL OR
  NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner) OR
  NOT EXISTS(SELECT 1 FROM public.v2_profiles WHERE user_id=p_owner)
 THEN RAISE EXCEPTION 'Training owner not established' USING ERRCODE='42501'; END IF;
 SELECT count(*),count(*) FILTER(WHERE status='active'),
  count(*) FILTER(WHERE status='retired')
 INTO v_total,v_active,v_retired
 FROM public.v2_training_athlete_restrictions WHERE user_id=p_owner;
 SELECT coalesce(pg_catalog.jsonb_object_agg(source,n),'{}'::jsonb)
 INTO v_by_source
 FROM (SELECT source,count(*) AS n
  FROM public.v2_training_athlete_restrictions WHERE user_id=p_owner
  GROUP BY source) q;
 SELECT certified_revision,inventory_digest,certified_at
 INTO v_cert_revision,v_cert_digest,v_certified_at
 FROM allin_private.v2_training_restriction_certifications
 WHERE user_id=p_owner;
 v_current_digest:=allin_private.v2_training_restriction_inventory_digest_candidate(p_owner);
 IF v_cert_revision IS NOT NULL THEN
  v_cert_matches:=v_cert_digest=v_current_digest AND
   v_certified_at IS NOT NULL AND
   v_certified_at<=pg_catalog.clock_timestamp() AND
   NOT EXISTS(SELECT 1 FROM public.v2_training_athlete_restrictions r
    WHERE r.user_id=p_owner AND
    (r.revision>v_cert_revision OR r.updated_at>v_certified_at));
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'ownerId',p_owner,
  'recordedRows',v_total,'recordedActive',v_active,
  'recordedRetired',v_retired,'recordedBySource',v_by_source,
  'recordedInventoryDigest',v_current_digest,
  'certificationPresent',v_cert_revision IS NOT NULL,
  'certificationMatchesRecordedRows',v_cert_matches,
  'certifiedRevision',v_cert_revision,
  -- These can only be set by an approved source-aware reconciler. A count
  -- of zero is never evidence that external and historical sources are empty.
  'historicalSourceCoverageVerified',false,
  'firstCertificationAuthorized',false,
  'reconciliationRequired',true);
END;$status$;
REVOKE ALL ON FUNCTION
 allin_private.v2_training_restriction_reconciliation_status_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- A later reviewed Auth-owner migration explicitly grants authenticated
-- EXECUTE. There are deliberately NO app grants in this candidate.
COMMIT;
