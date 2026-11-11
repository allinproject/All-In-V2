#!/usr/bin/env bash
# ALL-252: disposable PostgreSQL 17 two-session transaction replay.
# Requires the preceding candidate SQL replay in the CI-only database.
set -euo pipefail
: "$POSTGRES_CONTAINER_ID"
: "$PGUSER"
[[ "$PGUSER" == "postgres" ]] || { echo 'Refusing non-test role'; exit 2; }
database=allin_subscription_test
cid="$POSTGRES_CONTAINER_ID"
log_a="$(mktemp)"
log_b="$(mktemp)"
pid_a=""
cleanup() {
  if [[ -n "$pid_a" ]]; then wait "$pid_a" || true; fi
  rm -f "$log_a" "$log_b"
}
trap cleanup EXIT

docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000003');
INSERT INTO public.v2_profiles (user_id) VALUES ('00000000-0000-0000-0000-000000000003');
INSERT INTO allin_private.v2_subscription_checkout_attempts
 (attempt_id,owner_id,provider,environment,provider_checkout_id,provider_subscription_id)
VALUES ('10000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000003','stripe_web','sandbox','cs_race','sub_race');
INSERT INTO allin_private.v2_subscription_purchases
 (owner_id,provider,environment,provider_subscription_id,checkout_attempt_id)
VALUES ('00000000-0000-0000-0000-000000000003','stripe_web','sandbox','sub_race',
 '10000000-0000-0000-0000-000000000003');
SQL

docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
SET ROLE service_role;
BEGIN;
SELECT allin_private.v2_apply_verified_subscription_event(
 '00000000-0000-0000-0000-000000000003',
 'stripe_web','sandbox','sub_race','evt_race_refund',3,'refunded',NULL);
\echo RACE_LOCK_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid_a=$!

ready=0
for _ in $(seq 1 50); do
  if grep -q '^RACE_LOCK_HELD$' "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "First transaction did not acquire lock" >&2
  cat "$log_a" >&2
  exit 1
fi

docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<'SQL'
SET ROLE service_role;
SELECT allin_private.v2_apply_verified_subscription_event(
 '00000000-0000-0000-0000-000000000003',
 'stripe_web','sandbox','sub_race','evt_race_stale_paid',2,'paid','2026-12-31 UTC');
SQL
wait "$pid_a"
pid_a=""
if ! grep -q '^stale$' "$log_b"; then
  echo "Concurrent stale paid update was not rejected" >&2
  cat "$log_a" "$log_b" >&2
  exit 1
fi

docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
DO $verify$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM allin_private.v2_subscription_purchases
   WHERE provider='stripe_web' AND environment='sandbox'
     AND provider_subscription_id='sub_race'
     AND revision=3 AND phase='refunded' AND access_until IS NULL
 ) THEN
   RAISE EXCEPTION 'Concurrent update reopened paid access';
 END IF;
 IF (SELECT count(*) FROM allin_private.v2_subscription_verified_events
     WHERE provider_event_id='evt_race_refund') <> 1 OR
    (SELECT count(*) FROM allin_private.v2_subscription_verified_events
     WHERE provider_event_id='evt_race_stale_paid') <> 0 THEN
   RAISE EXCEPTION 'Race event receipts are inconsistent';
 END IF;
END
$verify$;
SQL
echo "PASS ALL-252 PostgreSQL concurrent refund versus stale paid replay"

# Two distinct trusted checkout attempts try to bind the SAME provider purchase
# to different accounts. PostgreSQL must not accept both bindings.
docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000005');
INSERT INTO public.v2_profiles (user_id) VALUES ('00000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000005');
INSERT INTO allin_private.v2_subscription_checkout_attempts
 (attempt_id,owner_id,provider,environment,provider_checkout_id,provider_subscription_id)
VALUES
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004',
  'stripe_web','sandbox','cs_bind_4','sub_bind_race'),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005',
  'stripe_web','sandbox','cs_bind_5','sub_bind_race');
SQL

: >"$log_a"
: >"$log_b"
docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
BEGIN;
INSERT INTO allin_private.v2_subscription_purchases
 (owner_id,provider,environment,provider_subscription_id,checkout_attempt_id)
VALUES ('00000000-0000-0000-0000-000000000004','stripe_web','sandbox','sub_bind_race',
'10000000-0000-0000-0000-000000000004');
\echo FIRST_BIND_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid_a=$!
ready=0
for _ in $(seq 1 50); do
  if grep -q '^FIRST_BIND_HELD$' "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "First purchase owner was not bound" >&2
  cat "$log_a" >&2
  exit 1
fi

if docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<'SQL'
SET lock_timeout = '7s';
INSERT INTO allin_private.v2_subscription_purchases
 (owner_id,provider,environment,provider_subscription_id,checkout_attempt_id)
VALUES ('00000000-0000-0000-0000-000000000005','stripe_web','sandbox','sub_bind_race',
'10000000-0000-0000-0000-000000000005');
SQL
then
  echo "CRITICAL: second owner claimed same provider purchase" >&2
  cat "$log_a" "$log_b" >&2
  exit 1
fi
wait "$pid_a"
pid_a=""
if ! grep -q 'duplicate key value violates unique constraint' "$log_b"; then
  echo "Second owner insert failed for a reason other than unique purchase identity" >&2
  cat "$log_a" "$log_b" >&2
  exit 1
fi

docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
DO $verify_bind$
BEGIN
 IF (SELECT count(*) FROM allin_private.v2_subscription_purchases
     WHERE provider='stripe_web' AND environment='sandbox'
       AND provider_subscription_id='sub_bind_race') <> 1 OR
    NOT EXISTS (
      SELECT 1 FROM allin_private.v2_subscription_purchases
      WHERE provider='stripe_web' AND environment='sandbox'
        AND provider_subscription_id='sub_bind_race'
        AND owner_id='00000000-0000-0000-0000-000000000004'
    ) THEN
  RAISE EXCEPTION 'First bind did not remain authoritative';
 END IF;
END
$verify_bind$;
SQL
echo "PASS ALL-252 PostgreSQL two-session first-purchase owner collision"
