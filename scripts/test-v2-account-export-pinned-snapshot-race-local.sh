#!/usr/bin/env bash
# ALL-251: real independent-session snapshot consistency in disposable CI ONLY.
set -euo pipefail
db="${1:?disposable Supabase PostgreSQL container required}"
[[ "${CI:-}" == "1" || "${CI:-}" == "true" ]] || {
  echo 'ALL-251 race test is local CI only' >&2; exit 1;
}
owner='a8111111-8111-4111-8111-811111111111'
session='a8222222-8222-4222-8222-822222222222'
request='a8333333-8333-4333-8333-833333333333'
thread='a8444444-8444-4444-8444-844444444444'
work="$(mktemp -d)"
cleanup() {
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DELETE FROM auth.users WHERE id='$owner'" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
pg() { docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
pg <<SQL
INSERT INTO auth.users(id) VALUES ('$owner');
INSERT INTO auth.sessions(id,user_id) VALUES ('$session','$owner');
INSERT INTO allin_private.v2_account_export_requests_candidate
 (request_id,user_id,session_id,status,expires_at) VALUES
 ('$request','$owner','$session','approved',now()+interval '1 hour');
INSERT INTO public.v2_coach_threads(id,user_id) VALUES ('$thread','$owner');
INSERT INTO public.v2_coach_messages
 (user_id,thread_id,role,content,client_action_id)
 VALUES ('$owner','$thread','user','before-snapshot',gen_random_uuid());
SQL
# Session A begins a read-only RR transaction and pins its snapshot before B.
pg >"$work/a.out" 2>&1 <<SQL &
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL ROLE service_role;
SELECT public.v2_account_export_inventory_review_candidate(
 '$owner','$session','$request') AS snapshot_proof;
SELECT pg_sleep(7);
DO \$snapshot_assert\$
DECLARE v_page jsonb;
BEGIN
 v_page:=public.v2_account_export_page_review_candidate(
 '$owner','$session','$request','public.v2_coach_messages',NULL,25);
 IF pg_catalog.jsonb_array_length(v_page->'rows')<>1
    OR v_page#>>'{rows,0,content}'<>'before-snapshot'
 THEN RAISE EXCEPTION 'Pinned export saw foreign-time mutation or lost original row';
 END IF;
 RAISE NOTICE 'PASS ALL-251: pinned RR source sees exactly pre-mutation message';
END \$snapshot_assert\$;
COMMIT;
SQL
pid_a=$!
sleep 1
# B writes while A's snapshot remains open.
pg >"$work/b.out" 2>&1 <<SQL &
INSERT INTO public.v2_coach_messages
 (user_id,thread_id,role,content,client_action_id)
 VALUES ('$owner','$thread','user','inserted-after-snapshot',gen_random_uuid());
SQL
pid_b=$!
wait "$pid_b" || { cat "$work/b.out"; exit 1; }
if ! kill -0 "$pid_a" 2>/dev/null; then
  cat "$work/a.out"; echo 'Export snapshot closed before B mutation completed' >&2; exit 1;
fi
wait "$pid_a" || { cat "$work/a.out"; exit 1; }
grep -q 'PASS ALL-251: pinned RR source' "$work/a.out" || {
  cat "$work/a.out"; exit 1;
}
pg <<SQL
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL ROLE service_role;
DO \$new_snapshot\$
DECLARE v_page jsonb;
BEGIN
 v_page:=public.v2_account_export_page_review_candidate(
 '$owner','$session','$request','public.v2_coach_messages',NULL,25);
 IF pg_catalog.jsonb_array_length(v_page->'rows')<>2
 THEN RAISE EXCEPTION 'Fresh account export failed to see committed mutation'; END IF;
 RAISE NOTICE 'PASS ALL-251: a fresh RR snapshot sees both committed messages';
END \$new_snapshot\$;
COMMIT;
SQL
echo 'PASS ALL-251: two PostgreSQL sessions prove stable owner export under concurrent mutation'
