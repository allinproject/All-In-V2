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
# Delete A only inside a separate isolated RESTORED DB transaction. FK
# cascading must remove all four A collections without disturbing B.
pg "$target_db" "
BEGIN;
DELETE FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111';
DO \$deletion\$
DECLARE a uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_training_routines WHERE user_id=a)
 OR EXISTS(SELECT 1 FROM public.v2_training_routine_versions WHERE user_id=a)
 OR EXISTS(SELECT 1 FROM allin_private.v2_training_routine_owner_epochs WHERE user_id=a)
 OR EXISTS(SELECT 1 FROM allin_private.v2_training_routine_actions WHERE user_id=a)
 THEN RAISE EXCEPTION 'Auth account deletion retained Routine user data'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_training_routines WHERE user_id=b)
 OR NOT EXISTS(SELECT 1 FROM public.v2_training_routine_versions WHERE user_id=b)
 THEN RAISE EXCEPTION 'Owner B was damaged by owner A account deletion'; END IF;
END;
\$deletion\$;
ROLLBACK;"
# Auth deletion is deliberately rolled back; only the ephemeral target changes.
docker exec "$db" rm -f "$dump_path"
echo 'PASS ALL-251/ALL-12: independently restored all four Routine owner tables, source-equal digests, RLS/ACL and account cascade owner isolation'
