#!/usr/bin/env bash
# ALL-222: two independent PostgreSQL sessions; disposable LOCAL Supabase only.
set -euo pipefail
db="${1:?local DB container required}"
[[ "${CI:-}" == "1" ]] || { echo 'CI-only local replay' >&2; exit 1; }
owner='66666666-6666-4666-8666-666666666666'
action='aaaaaaaa-6666-4666-8666-666666666666'
tmp="$(mktemp -d)"
cleanup() {
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DELETE FROM auth.users WHERE id='$owner'" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
psql_local() { docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_local -c "INSERT INTO auth.users(id) VALUES ('$owner')"
psql_local >"$tmp/a.out" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$owner',true);
SELECT thread_id FROM public.v2_coach_get_or_create_thread();
SELECT pg_sleep(6);
COMMIT;
SQL
pid_a=$!
sleep 1
docker exec -e PGAPPNAME=all222_coach_first_open -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$tmp/b.out" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$owner',true);
SELECT thread_id FROM public.v2_coach_get_or_create_thread();
COMMIT;
SQL
pid_b=$!
blocked=false
for attempt in $(seq 1 40); do
  waiting="$(docker exec "$db" psql -X -U postgres -d postgres -At -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='all222_coach_first_open' AND wait_event_type='Lock'" | tr -d '\r')"
  if [[ "$waiting" -ge 1 ]]; then blocked=true; break; fi
  if ! kill -0 "$pid_b" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$blocked" != true ]]; then cat "$tmp/a.out" "$tmp/b.out"; echo 'Missing first-open contention' >&2; exit 1; fi
wait "$pid_a"
wait "$pid_b"
thread="$(psql_local -At -c "SELECT id FROM public.v2_coach_threads WHERE user_id='$owner'" | tr -d '\r')"
[[ -n "$thread" ]] || { echo 'Missing canonical thread' >&2; exit 1; }
psql_local >"$tmp/c.out" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$owner',true);
SELECT public.v2_coach_append_user_message('$thread','$action','Simultaneous retry');
SELECT pg_sleep(6);
COMMIT;
SQL
pid_c=$!
sleep 1
docker exec -e PGAPPNAME=all222_coach_append_retry -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$tmp/d.out" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$owner',true);
SELECT public.v2_coach_append_user_message('$thread','$action','Simultaneous retry');
COMMIT;
SQL
pid_d=$!
blocked=false
for attempt in $(seq 1 40); do
  waiting="$(docker exec "$db" psql -X -U postgres -d postgres -At -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='all222_coach_append_retry' AND wait_event_type='Lock'" | tr -d '\r')"
  if [[ "$waiting" -ge 1 ]]; then blocked=true; break; fi
  if ! kill -0 "$pid_d" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$blocked" != true ]]; then cat "$tmp/c.out" "$tmp/d.out"; echo 'Missing append contention' >&2; exit 1; fi
wait "$pid_c"
wait "$pid_d"
psql_local <<SQL
DO \$verify\$
BEGIN
 IF (SELECT count(*) FROM public.v2_coach_threads WHERE user_id='$owner')<>1
 OR (SELECT count(*) FROM public.v2_coach_messages WHERE user_id='$owner' AND client_action_id='$action')<>1
 OR (SELECT count(*) FROM allin_private.v2_coach_message_actions WHERE user_id='$owner' AND client_action_id='$action')<>1
 THEN RAISE EXCEPTION 'Concurrent Coach operations produced duplicate or missing records'; END IF;
 RAISE NOTICE 'PASS ALL-222: two sessions, one thread, one message, one action receipt';
END \$verify\$;
SQL
