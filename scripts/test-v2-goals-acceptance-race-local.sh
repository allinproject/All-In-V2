#!/usr/bin/env bash
# ALL-239: two PostgreSQL connections, disposable local Supabase only.
set -euo pipefail
db="$1"
owner="33333333-3333-4333-8333-333333333333"
goal="aaaaaaaa-3333-4333-8333-333333333333"
rev_a="bbbbbbbb-3333-4333-8333-333333333333"
rev_b="cccccccc-3333-4333-8333-333333333333"
action_a="dddddddd-3333-4333-8333-333333333333"
action_b="eeeeeeee-3333-4333-8333-333333333333"
key=239246
tmp="$(mktemp -d)"
cleanup() {
 docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
   -c "DELETE FROM auth.users WHERE id='$owner';" >/dev/null || true
 rm -rf "$tmp"
}
trap cleanup EXIT
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$owner');
INSERT INTO public.v2_goals(id,user_id,goal_kind,title,status)
VALUES ('$goal','$owner','endurance_distance','CAS race','active');
INSERT INTO public.v2_goal_revisions(id,goal_id,user_id,revision_number,status,source_kind)
VALUES ('$rev_a','$goal','$owner',1,'candidate','athlete_authored'),
       ('$rev_b','$goal','$owner',2,'candidate','athlete_authored');
SQL
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$tmp/a.out" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock($key);
SELECT id FROM public.v2_goals WHERE id='$goal' FOR UPDATE;
SELECT pg_sleep(5);
SELECT public.v2_goal_accept_revision_candidate(
 '$owner','$goal','$rev_a','$action_a',1,repeat('a',64));
COMMIT;
SQL
pid_a=$!
locked=false
for attempt in $(seq 1 45); do
 if ! kill -0 "$pid_a" 2>/dev/null; then cat "$tmp/a.out"; exit 1; fi
 check="$(docker exec "$db" psql -X -U postgres -d postgres -At \
   -c "SELECT pg_try_advisory_lock($key)" | tr -d '\r')"
 if [[ "$check" == "f" ]]; then locked=true; break; fi
 sleep 0.1
done
if [[ "$locked" != true ]]; then echo "No first-writer lock" >&2; exit 1; fi
docker exec -e PGAPPNAME=all239_goal_loser -i "$db" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$tmp/b.out" 2>&1 <<SQL &
SELECT public.v2_goal_accept_revision_candidate(
 '$owner','$goal','$rev_b','$action_b',1,repeat('b',64));
SQL
pid_b=$!
blocked=false
for attempt in $(seq 1 35); do
 count="$(docker exec "$db" psql -X -U postgres -d postgres -At \
   -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='all239_goal_loser' AND wait_event_type='Lock'")"
 if [[ "$count" -ge 1 ]]; then blocked=true; break; fi
 if ! kill -0 "$pid_b" 2>/dev/null; then break; fi
 sleep 0.1
done
if [[ "$blocked" != true ]]; then cat "$tmp/a.out" "$tmp/b.out"; echo "No observed contention" >&2; exit 1; fi
wait "$pid_a"
if wait "$pid_b"; then echo "Stale Goal acceptance succeeded" >&2; exit 1; fi
grep -q "Goal version or lifecycle changed" "$tmp/b.out" || { cat "$tmp/b.out"; exit 1; }
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$check\$
BEGIN
 IF (SELECT version FROM public.v2_goals WHERE id='$goal') <> 2
    OR (SELECT active_revision_id FROM public.v2_goals WHERE id='$goal') <> '$rev_a'::uuid
    OR (SELECT count(*) FROM public.v2_goal_revisions WHERE goal_id='$goal' AND status='accepted') <> 1
    OR (SELECT count(*) FROM allin_private.v2_goal_acceptance_actions WHERE goal_id='$goal') <> 1
    OR (SELECT status FROM public.v2_goal_revisions WHERE id='$rev_b') <> 'candidate'
 THEN RAISE EXCEPTION 'Goal CAS race persisted inconsistent state'; END IF;
 RAISE NOTICE 'PASS ALL-239: concurrent stale approval blocked with one canonical receipt';
END \$check\$;
SQL
