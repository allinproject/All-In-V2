#!/usr/bin/env bash
# ALL-243: real two-connection metric-ingest vs activity/source mutations.
# Runs ONLY on a disposable PostgreSQL 17 CI service; no hosted credentials.
set -euo pipefail
: "${PG_CONTAINER:?CI PostgreSQL service container required}"
[[ "$PG_CONTAINER" =~ ^[a-f0-9]{12,64}$ ]] || { echo "Invalid disposable container ID" >&2; exit 2; }
a=$(mktemp); b=$(mktemp); pid=""
cleanup(){ if [[ -n "$pid" ]]; then wait "$pid" || true; fi; rm -f "$a" "$b"; }
trap cleanup EXIT
owner="11111111-1111-4111-8111-111111111111"
activity="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
source="cccccccc-cccc-4ccc-8ccc-cccccccccccc"

for case in activity source; do
  db="v2_ingest_race_${case}"
  docker exec "$PG_CONTAINER" createdb -U postgres -T device_ingest_rls "$db"
  : >"$a"; : >"$b"
  # First session holds an uncommitted invalidation/rejection. This deliberately
  # tests the real unprotected UPDATE path as it exists today, not a mocked lock.
  if [[ "$case" == activity ]]; then
    mutation="UPDATE public.v2_completed_activities SET status='invalidated' WHERE id='$activity';"
  else
    mutation="UPDATE public.v2_activity_sources SET quality='rejected' WHERE id='$source';"
  fi
  docker exec -i "$PG_CONTAINER" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$a" 2>&1 <<SQL &
BEGIN;
$mutation
\\echo MUTATION_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
  pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if grep -q '^MUTATION_HELD$' "$a"; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ "$ready" != 1 ]]; then echo "Mutation did not hold transaction" >&2; cat "$a"; exit 1; fi
  # Second independent session uses real restricted, NOLOGIN ingest role.
  # A correct cross-writer fence must NOT accept metric evidence while the
  # source/activity is already being invalidated in another transaction.
  docker exec -i "$PG_CONTAINER" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$b" 2>&1 <<SQL &
SET ROLE allin_v2_device_ingest;
SET request.jwt.claim.sub='$owner';
SET lock_timeout='7s';
SELECT allin_private.v2_device_ingest_scalar_gateway_candidate(
 repeat('7',64),repeat('8',64),'$owner','$activity','$source',
 'abababab-abab-4aba-8aba-abababababab',
 'draft_metric',1,'source_measured',121,NULL,NULL,repeat('a',64),'partial');
SQL
  ingest_pid=$!
  wait "$ingest_pid" || true
  wait "$pid" || { echo "Mutator failed" >&2; cat "$a"; exit 1; }
  pid=""
  # The final persisted state, not only the exit status, determines safety.
  count=$(docker exec "$PG_CONTAINER" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.v2_activity_metric_values WHERE id='abababab-abab-4aba-8aba-abababababab'")
  if [[ "$count" != 0 ]]; then
    echo "FAIL ALL-243 concurrency gate: $case mutation overlapped and accepted stale metric" >&2
    cat "$a" "$b" >&2
    exit 1
  fi
  echo "PASS ALL-243 $case mutation prevented overlapping stale metric"
done
echo 'PASS ALL-243 two-connection mutation / ingest race gate'
