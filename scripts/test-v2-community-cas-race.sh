#!/usr/bin/env bash
set -euo pipefail
# ALL-244 disposable two-session PostgreSQL CAS replay.
# Requires the preceding reader test fixture in the same isolated CI DB:
# actor 1 and 2 alive, pair revision 5, target 2 public, no current blocks.
container="${1:?PostgreSQL service container ID is required}"
db="${2:-community_contract}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

uuid1='00000000-0000-0000-0000-000000000001'
uuid2='00000000-0000-0000-0000-000000000002'

initial="$(docker exec "$container" psql -U postgres -d "$db" -Atqc "
 SELECT version FROM allin_private.v2_community_pair_revisions
 WHERE lower_user_id='$uuid1' AND upper_user_id='$uuid2';")"
if [[ "$initial" != 5 ]]; then
  echo "Wrong isolated Community pair starting revision: $initial" >&2
  exit 1
fi

sql_a="SET application_name = 'community-cas-test-A';
BEGIN;
SELECT set_config('request.jwt.claim.sub','$uuid1',false);
SELECT public.v2_community_relationship_write(
 '$uuid1','$uuid2','follow',5,
 '30000000-0000-0000-0000-000000000001',
 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
SELECT pg_sleep(3);
COMMIT;"
docker exec "$container" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -c "$sql_a" > "$tmp_dir/a.log" 2>&1 &
pid_a=$!

# Do not start contender until PostgreSQL confirms A reached pg_sleep
# INSIDE the transaction after the writer locked and updated the pair.
ready=0
for attempt in {1..50}; do
  count="$(docker exec "$container" psql -U postgres -d "$db" -Atqc "
    SELECT count(*) FROM pg_stat_activity
    WHERE application_name='community-cas-test-A'
    AND wait_event='PgSleep';")"
  if [[ "$count" == 1 ]]; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  wait "$pid_a" || true
  echo "First writer never reached locked PostgreSQL sleep" >&2
  cat "$tmp_dir/a.log" >&2
  exit 1
fi

sql_b="SET application_name = 'community-cas-test-B';
SELECT set_config('request.jwt.claim.sub','$uuid2',false);
SELECT public.v2_community_relationship_write(
 '$uuid2','$uuid1','block',5,
 '30000000-0000-0000-0000-000000000002',
 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);"
if docker exec "$container" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -c "$sql_b" > "$tmp_dir/b.log" 2>&1; then
  echo "FAIL: stale opposing block unexpectedly succeeded" >&2
  cat "$tmp_dir/b.log" >&2
  wait "$pid_a" || true
  exit 1
fi
wait "$pid_a"
if ! grep -q 'stale_relationship_revision' "$tmp_dir/b.log"; then
  echo "FAIL: competing writer failed for a different reason" >&2
  cat "$tmp_dir/b.log" >&2
  exit 1
fi

result="$(docker exec "$container" psql -U postgres -d "$db" -Atqc "
 SELECT (SELECT version FROM allin_private.v2_community_pair_revisions
         WHERE lower_user_id='$uuid1' AND upper_user_id='$uuid2')
    || ':' ||
    (SELECT count(*) FROM allin_private.v2_community_follows
     WHERE follower_id='$uuid1' AND followed_id='$uuid2' AND state='approved')
    || ':' ||
    (SELECT count(*) FROM allin_private.v2_community_blocks
     WHERE (blocker_id='$uuid1' AND blocked_id='$uuid2')
        OR (blocker_id='$uuid2' AND blocked_id='$uuid1'))
    || ':' ||
    (SELECT count(*) FROM allin_private.v2_community_action_receipts
     WHERE action_id IN
       ('30000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002'));")"
if [[ "$result" != "6:1:0:1" ]]; then
  echo "FAIL: incorrect single-winner durable Community state: $result" >&2
  exit 1
fi
echo 'PASS: two PostgreSQL sessions serialized Community pair CAS; stale competing block was rejected.'
