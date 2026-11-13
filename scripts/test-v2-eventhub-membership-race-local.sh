#!/usr/bin/env bash
# ALL-244: same athlete, two real PostgreSQL sessions, same group join version.
# Disposable LOCAL Supabase only, never hosted SQL. Exact one winner.
set -euo pipefail
db="$1"
owner="33333333-3333-4333-8333-333333333333"
session_a="44444444-4444-4444-8444-444444444444"
session_b="55555555-5555-4555-8555-555555555555"
event="aaaaaaaa-3333-4333-8333-333333333333"
group="bbbbbbbb-3333-4333-8333-333333333333"
alias_id="cccccccc-3333-4333-8333-333333333333"
action_a="dddddddd-3333-4333-8333-333333333333"
action_b="eeeeeeee-3333-4333-8333-333333333333"
tmp="$(mktemp -d)"
cleanup(){
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DELETE FROM auth.users WHERE id='$owner'; DELETE FROM public.v2_events WHERE id='$event';" >/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES('$owner');
INSERT INTO auth.sessions(id,user_id)
VALUES('$session_a','$owner'),('$session_b','$owner');
INSERT INTO public.v2_events(id,edition_id,name,sport,event_kind,
  start_local_date,event_timezone,source_verification)
VALUES('$event','10000000-0000-4000-8000-000000000004','Race with an EventHub group','running','race',
 DATE '2027-04-10','America/Chicago','organizer_verified');
INSERT INTO public.v2_event_groups(id,event_id,state) VALUES('$group','$event','active');
INSERT INTO public.v2_event_url_aliases(
 id,event_id,canonical_url,evidence_kind,source_checked_at)
VALUES('$alias_id','$event','https://example.org/eventhub/race',
 'organizer_verified',now());
SQL
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  >"$tmp/a.out" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(
  pg_catalog.hashtextextended('$owner'||':'||'$group',0));
SELECT pg_sleep(8);
SELECT allin_private.v2_event_group_action_candidate(
 '$owner','$session_a','$event','$group','$action_a','$alias_id','join',1);
COMMIT;
SQL
pid_a=$!
locked=false
for attempt in $(seq 1 40); do
  if ! kill -0 "$pid_a" 2>/dev/null; then
    cat "$tmp/a.out"
    echo "First EventHub join ended before the lock" >&2
    exit 1
  fi
  state="$(docker exec "$db" psql -X -U postgres -d postgres -At -c \
    "SELECT pg_try_advisory_lock(pg_catalog.hashtextextended('$owner'||':'||'$group',0))" | tr -d '\r')"
  if [[ "$state" == "f" ]]; then locked=true; break; fi
  sleep 0.1
done
if [[ "$locked" != true ]]; then
  cat "$tmp/a.out"
  echo "First EventHub join did not obtain its advisory lock" >&2
  exit 1
fi
docker exec -e PGAPPNAME=all244_eventhub_join_loser -i "$db" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$tmp/b.out" 2>&1 <<SQL &
SELECT allin_private.v2_event_group_action_candidate(
 '$owner','$session_b','$event','$group','$action_b','$alias_id','join',1);
SQL
pid_b=$!
blocked=false
for attempt in $(seq 1 55); do
  waiting="$(docker exec "$db" psql -X -U postgres -d postgres -At -c \
    "SELECT count(*) FROM pg_stat_activity
     WHERE application_name='all244_eventhub_join_loser' AND wait_event_type='Lock'")"
  if [[ "$waiting" -ge 1 ]]; then blocked=true; break; fi
  if ! kill -0 "$pid_b" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$blocked" != true ]]; then
  cat "$tmp/a.out" "$tmp/b.out"
  echo "Did not observe real concurrent EventHub join lock contention" >&2
  exit 1
fi
wait "$pid_a"
if wait "$pid_b"; then
  cat "$tmp/b.out"
  echo "Stale second EventHub join incorrectly succeeded" >&2
  exit 1
fi
if ! grep -q "EventHub membership version changed" "$tmp/b.out"; then
  cat "$tmp/b.out"
  echo "Unexpected losing join error" >&2
  exit 1
fi
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$check\$
BEGIN
  IF (SELECT count(*) FROM public.v2_event_group_memberships
    WHERE user_id='$owner' AND group_id='$group' AND state='joined'
      AND version=2 AND participant_visible=false)<>1
  OR (SELECT count(*) FROM allin_private.v2_event_group_actions
    WHERE user_id='$owner' AND group_id='$group')<>1
  OR EXISTS(SELECT 1 FROM public.v2_event_participations WHERE user_id='$owner')
  THEN RAISE EXCEPTION 'Concurrent EventHub join duplicated membership, receipt or registration'; END IF;
  RAISE NOTICE 'PASS ALL-244: two independent joins serialized, one hidden group membership, no fake registration';
END \$check\$;
SQL
