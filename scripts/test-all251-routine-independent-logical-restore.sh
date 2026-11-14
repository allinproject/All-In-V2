#!/usr/bin/env bash
# ALL-251/ALL-12: disposable ONLY. Independent logical PostgreSQL clone for
# all four Saved Routine owner tables, including immutable versions and
# internal action receipts. This is NOT Supabase provider physical restore,
# Storage-media recovery, or an approved production account deletion.
set -euo pipefail
[[ "${CI:-}" == "1" ]] || { echo 'Refusing non-CI restore rehearsal' >&2; exit 1; }
db="${1:?Expected the disposable PG17 service container ID}"
running="$(docker inspect --format '{{.State.Running}}' "$db" 2>/dev/null || true)"
image="$(docker inspect --format '{{.Config.Image}}' "$db" 2>/dev/null || true)"
[[ "$running" == "true" && "$image" == "postgres:17" ]] || {
 echo 'Refusing non-running/non-disposable PostgreSQL 17 container' >&2; exit 1; }
source_db='training_routine_export'
target_db='all251_independent_routine_restore'
dump_path='/tmp/all251-routines-independent-restore.dump'
pg() { docker exec "$db" psql -X -qAt -U postgres -d "$1" -v ON_ERROR_STOP=1 -c "$2"; }
docker exec "$db" pg_dump -U postgres -d "$source_db" -Fc -f "$dump_path"
docker exec "$db" createdb -U postgres "$target_db"
docker exec "$db" pg_restore -U postgres --exit-on-error --no-owner -d "$target_db" "$dump_path"

# Compare every real database column of four owner domain relations. The
# source is populated by the prior canonical ALL-246/251 integration test.
fingerprint_sql=$(cat <<'SQL'
SELECT pg_catalog.md5(
 (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.user_id,r.id),'[]'::jsonb)::text
    FROM public.v2_training_routines r) ||':'||
 (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) ORDER BY v.user_id,v.routine_id,v.version),'[]'::jsonb)::text
    FROM public.v2_training_routine_versions v) ||':'||
 (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) ORDER BY e.user_id),'[]'::jsonb)::text
    FROM allin_private.v2_training_routine_owner_epochs e) ||':'||
 (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.user_id,a.action_id),'[]'::jsonb)::text
    FROM allin_private.v2_training_routine_actions a)
);
SQL
)
original="$(pg "$source_db" "$fingerprint_sql")"
restored="$(pg "$target_db" "$fingerprint_sql")"
[[ -n "$original" && "$original" == "$restored" ]] || {
 echo 'FAIL ALL-251: independent restored Routine owner rows differ from source' >&2; exit 1; }
# SHA256 fingerprints of the domain row concatenation are preferable for
# release evidence; this exact-equality digest is for disposable replay only.
pg "$target_db" "
DO \$verify\$
DECLARE
 a uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 n integer;
BEGIN
 IF (SELECT count(*) FROM public.v2_training_routines WHERE user_id=a)<>1
 OR (SELECT count(*) FROM public.v2_training_routine_versions WHERE user_id=a)<>1
 OR (SELECT count(*) FROM allin_private.v2_training_routine_owner_epochs WHERE user_id=a)<>1
 OR (SELECT count(*) FROM allin_private.v2_training_routine_actions WHERE user_id=a)<>1
 OR (SELECT count(*) FROM public.v2_training_routines WHERE user_id=b)<>1
 THEN RAISE EXCEPTION 'Independent restore missing one owner or history row'; END IF;
 SELECT count(*) INTO n FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
 WHERE (ns.nspname||'.'||c.relname) IN (
  'public.v2_training_routines','public.v2_training_routine_versions',
  'allin_private.v2_training_routine_owner_epochs',
  'allin_private.v2_training_routine_actions')
 AND c.relrowsecurity
 AND NOT pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
 AND NOT pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE');
 IF n<>4 THEN RAISE EXCEPTION 'Restored Routine RLS or client grants changed'; END IF;
END;
\$verify\$;"
# Full-populated-owner Auth deletion is *deliberately blocked* by the
# unrelated Profile graph in this review fixture. Preserve that gate: do
# not drop/alter Profile constraints to make a Routine test pass.
pg "$target_db" "
BEGIN;
DO \$blocked\$
BEGIN
 BEGIN
  DELETE FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111';
  RAISE EXCEPTION 'Unexpected populated account deletion succeeded';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END;
\$blocked\$;
ROLLBACK;"
# A separate third identity, created only in the restored disposable DB,
# has exactly the four Routine-owned rows and NO Profile/Coach/other data.
# This tests the actual Auth cascade without bypassing broader constraints.
pg "$target_db" "
BEGIN;
INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.v2_training_routines(id,user_id,current_version)
 VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '33333333-3333-4333-8333-333333333333',1);
INSERT INTO public.v2_training_routine_versions
(routine_id,user_id,version,name,sport,notes,blocks)
VALUES (
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '33333333-3333-4333-8333-333333333333',
 1,'Restored Synthetic Routine','strength','',
 '[{\"kind\":\"strength\",\"id\":\"step-1\",\"exercise\":\"Squat\",
 \"equipment\":null,\"notes\":\"\",\"sets\":3,\"reps\":\"5\",
 \"weight\":null,\"restSeconds\":90,\"setType\":\"working\",\"groupId\":null}]'::jsonb);
INSERT INTO allin_private.v2_training_routine_owner_epochs(user_id,epoch)
 VALUES ('33333333-3333-4333-8333-333333333333',1);
INSERT INTO allin_private.v2_training_routine_actions
(user_id,action_id,payload_digest,routine_id,result_version)
VALUES('33333333-3333-4333-8333-333333333333',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '00000000000000000000000000000000',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',1);
DELETE FROM auth.users WHERE id='33333333-3333-4333-8333-333333333333';
DO \$deletion\$
DECLARE c uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_training_routines WHERE user_id=c)
 OR EXISTS(SELECT 1 FROM public.v2_training_routine_versions WHERE user_id=c)
 OR EXISTS(SELECT 1 FROM allin_private.v2_training_routine_owner_epochs WHERE user_id=c)
 OR EXISTS(SELECT 1 FROM allin_private.v2_training_routine_actions WHERE user_id=c)
 THEN RAISE EXCEPTION 'Restored Routine cascade retained synthetic user data'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_training_routines WHERE user_id=a)
 OR NOT EXISTS(SELECT 1 FROM public.v2_training_routine_versions WHERE user_id=a)
 OR NOT EXISTS(SELECT 1 FROM public.v2_training_routines WHERE user_id=b)
 OR NOT EXISTS(SELECT 1 FROM public.v2_training_routine_versions WHERE user_id=b)
 THEN RAISE EXCEPTION 'Unrelated owner lost data during test'; END IF;
END;
\$deletion\$;
ROLLBACK;"
docker exec "$db" rm -f "$dump_path"
echo 'PASS ALL-251/ALL-12: independent Routine restore equality, RLS/ACL; isolated Routine Auth cascade passes, full populated account deletion remains blocked'
