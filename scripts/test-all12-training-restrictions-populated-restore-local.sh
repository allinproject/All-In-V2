#!/usr/bin/env bash
# ALL-230/ALL-12: isolated logical recovery of the existing Training restriction
# owner graph. Synthetic evidence verifies data preservation only; it does NOT
# establish hosted provider backup, legacy source completeness or certification
# authority. Never execute against a live database.
set -euo pipefail
test "${CI:-}" = "1"
db="${1:?isolated PostgreSQL service container required}"
[[ "$db" == "$(docker ps --filter id="$db" --format '{{.ID}}' | head -n 1)" ]] || {
 echo 'Refusing unknown PostgreSQL container' >&2; exit 1;
}
name=allin_restrictions_restore_test
psql_local() {
 docker exec -i "$db" psql -X -qAt -U postgres -d "$name" -v ON_ERROR_STOP=1
}
docker exec "$db" createdb -U postgres "$name"
psql_local <<'SQL'
CREATE SCHEMA auth;
CREATE SCHEMA allin_private;
DO $roles$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roles$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,not_after timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $uid$
 SELECT nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$uid$;
CREATE TABLE public.v2_profiles(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
\i /tmp/allin/docs/architecture/sql/V2-TRAINING-ATHLETE-RESTRICTIONS-OWNER-REVIEW-CANDIDATE.sql
\i /tmp/allin/docs/architecture/sql/V2-TRAINING-RESTRICTION-WRITER-REVIEW-CANDIDATE.sql
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.v2_profiles(user_id)
 SELECT id FROM auth.users;
INSERT INTO public.v2_training_athlete_restrictions
 (id,user_id,category,subject,source,status,revision)
VALUES
 ('a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','exercise','No lying leg curl','explicit_user','active',2),
 ('a2222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','exercise','Retired legacy restriction','explicit_user','retired',2),
 ('b1111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','equipment','No machine available','explicit_user','active',2),
 ('b2222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','exercise','Old imported constraint','approved_plan','retired',2);
INSERT INTO allin_private.v2_training_restriction_certifications
 (user_id,certified_revision,inventory_digest)
SELECT id,2,allin_private.v2_training_restriction_inventory_digest_candidate(id)
 FROM auth.users;
INSERT INTO allin_private.v2_training_restriction_action_receipts
 (user_id,action_id,request_hash,result_revision)
SELECT id,
 CASE WHEN id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  THEN 'a3333333-3333-4333-8333-333333333333'::uuid
  ELSE 'b3333333-3333-4333-8333-333333333333'::uuid END,
 repeat('c',32),2
FROM auth.users;
INSERT INTO allin_private.v2_training_restriction_source_evidence
 (user_id,snapshot_version,source_kind,evidence_ref,source_digest,
 canonical_inventory_digest,inspected_count,reconciled_count,unresolved_count,complete)
SELECT u.id,'isolated-recovery',
 kind,kind||':'||u.id::text,repeat('d',64),
 allin_private.v2_training_restriction_inventory_digest_candidate(u.id),
 0,0,0,true
FROM auth.users u CROSS JOIN unnest(ARRAY[
 'current_restrictions','approved_plans','historical_records',
 'imported_records','restored_records']) kind;
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.v2_training_athlete_restrictions)<>4
 OR (SELECT count(*) FROM allin_private.v2_training_restriction_certifications)<>2
 OR (SELECT count(*) FROM allin_private.v2_training_restriction_action_receipts)<>2
 OR (SELECT count(*) FROM allin_private.v2_training_restriction_source_evidence)<>10
 THEN RAISE EXCEPTION 'Missing synthetic two-owner recovery input'; END IF;
END $verify$;
SQL

# Snapshot/restore verification compares independent full-row fingerprints
# outside PostgreSQL, including retired rules and append-only source evidence.
manifest() {
 local table order
 for table in public.v2_training_athlete_restrictions \
   allin_private.v2_training_restriction_certifications \
   allin_private.v2_training_restriction_action_receipts \
   allin_private.v2_training_restriction_source_evidence; do
  case "$table" in
   public.v2_training_athlete_restrictions) order='id' ;;
   allin_private.v2_training_restriction_certifications) order='user_id' ;;
   allin_private.v2_training_restriction_action_receipts) order='action_id' ;;
   *) order='snapshot_version,source_kind' ;;
  esac
  printf "SELECT '%s'||E'\\t'||user_id::text||E'\\t'||count(*)||E'\\t'||md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY %s)) FROM %s t GROUP BY user_id ORDER BY user_id;\n" \
   "$table" "$order" "$table" | psql_local
 done
}
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 8
docker exec "$db" pg_dump -U postgres -d "$name" --format=custom --data-only \
 --table=public.v2_training_athlete_restrictions \
 --table=allin_private.v2_training_restriction_certifications \
 --table=allin_private.v2_training_restriction_action_receipts \
 --table=allin_private.v2_training_restriction_source_evidence \
 --file=/tmp/all12-training-restriction-graph.dump
psql_local <<'SQL'
DELETE FROM allin_private.v2_training_restriction_source_evidence;
DELETE FROM allin_private.v2_training_restriction_action_receipts;
DELETE FROM allin_private.v2_training_restriction_certifications;
DELETE FROM public.v2_training_athlete_restrictions;
SQL
docker exec "$db" pg_restore -U postgres -d "$name" \
 --data-only --exit-on-error /tmp/all12-training-restriction-graph.dump
after="$(manifest)"
if [[ "$before" != "$after" ]]; then
 diff -u <(echo "$before") <(echo "$after") || true
 echo 'ALL-12 Training restriction full-row recovery changed' >&2
 exit 1
fi
psql_local <<'SQL'
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM allin_private.v2_training_restriction_certifications c
  WHERE c.inventory_digest IS DISTINCT FROM
   allin_private.v2_training_restriction_inventory_digest_candidate(c.user_id))
 OR EXISTS(SELECT 1 FROM allin_private.v2_training_restriction_source_evidence e
  WHERE e.canonical_inventory_digest IS DISTINCT FROM
   allin_private.v2_training_restriction_inventory_digest_candidate(e.user_id))
 OR (SELECT count(*) FROM public.v2_training_athlete_restrictions WHERE status='retired')<>2
 THEN RAISE EXCEPTION 'Restored restriction graph lost owner history/evidence'; END IF;
END $verify$;
DELETE FROM public.v2_training_athlete_restrictions
 WHERE id='a2222222-2222-4222-8222-222222222222';
SQL
if [[ "$(manifest)" == "$after" ]]; then
 echo 'Missing retired restriction escaped recovery fingerprint' >&2
 exit 1
fi
docker exec "$db" rm -f /tmp/all12-training-restriction-graph.dump
echo 'PASS ALL-230/ALL-12: isolated two-owner restriction graph pg_dump/pg_restore and missing-retired-row detection; NO hosted acceptance'
