#!/usr/bin/env bash
set -euo pipefail
# ALL-244: review-only two-session visibility-vs-follow race in CI PostgreSQL.
container="${1:?PostgreSQL container required}"
database="${2:-community_contract}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
first='00000000-0000-0000-0000-000000000001'
second='00000000-0000-0000-0000-000000000002'

state="$(docker exec "$container" psql -U postgres -d "$database" -Atqc "
 SELECT (SELECT version FROM allin_private.v2_community_pair_revisions
 WHERE lower_user_id='$first' AND upper_user_id='$second') || ':' ||
 (SELECT profile_visibility || ':' || version
 FROM allin_private.v2_community_visibility WHERE user_id='$second');")"
if [[ "$state" != '5:public:3' ]]; then
 echo "Unexpected starting visibility race fixture: $state" >&2
 exit 1
fi

# Target changes public -> private and holds its visibility row locked.
# A follower using the old public evidence must not win after commit.
docker exec "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -c "
SET application_name='community-visibility-race-target';
BEGIN;
SELECT set_config('request.jwt.claim.sub','$second',false);
SELECT public.v2_community_set_my_visibility('$second','private',3);
SELECT pg_sleep(3);
COMMIT;" > "$tmp/target.log" 2>&1 &
first_pid=$!

ready=0
for _ in {1..50}; do
  count="$(docker exec "$container" psql -U postgres -d "$database" -Atqc "
 SELECT count(*) FROM pg_stat_activity
 WHERE application_name='community-visibility-race-target'
 AND wait_event='PgSleep';")"
  if [[ "$count" == 1 ]]; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
 wait "$first_pid" || true
 echo 'Target visibility writer did not reach locked sleep' >&2
 cat "$tmp/target.log" >&2
 exit 1
fi

if docker exec "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -c "
SET application_name='community-visibility-race-follower';
SELECT set_config('request.jwt.claim.sub','$first',false);
SELECT public.v2_community_relationship_write(
 '$first','$second','follow',5,
 '40000000-0000-0000-0000-000000000001',
 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);" > "$tmp/follower.log" 2>&1; then
 wait "$first_pid"
 echo 'FAIL: direct follow was accepted across public->private transition' >&2
 cat "$tmp/follower.log" >&2
 exit 1
fi
wait "$first_pid"
if ! grep -q 'visibility_requires_other_follow_action' "$tmp/follower.log"; then
 echo 'FAIL: competing follow failed for unexpected reason' >&2
 cat "$tmp/follower.log" >&2
 exit 1
fi
after="$(docker exec "$container" psql -U postgres -d "$database" -Atqc "
 SELECT (SELECT version FROM allin_private.v2_community_pair_revisions
 WHERE lower_user_id='$first' AND upper_user_id='$second') || ':' ||
 (SELECT profile_visibility || ':' || version
 FROM allin_private.v2_community_visibility WHERE user_id='$second') || ':' ||
 (SELECT count(*) FROM allin_private.v2_community_follows
 WHERE follower_id='$first' AND followed_id='$second') || ':' ||
 (SELECT count(*) FROM allin_private.v2_community_action_receipts
 WHERE action_id='40000000-0000-0000-0000-000000000001');")"
if [[ "$after" != '5:private:4:0:0' ]]; then
 echo "FAIL: wrong final private-state or stale follow leaked: $after" >&2
 exit 1
fi
echo 'PASS: concurrent privacy change beat direct follow; no stale approval, pair revision, or receipt.'
