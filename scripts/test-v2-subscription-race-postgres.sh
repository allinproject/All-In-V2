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
 (attempt_id,owner_id,provider,environment,provider_checkout_id,provider_subscription_id,state,verified_at)
VALUES ('10000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000003','stripe_web','sandbox','cs_race','sub_race','server_confirmed',now());
SET ROLE service_role;
SELECT allin_private.v2_bind_confirmed_subscription_purchase(
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
 (attempt_id,owner_id,provider,environment,provider_checkout_id,provider_subscription_id,state,verified_at)
VALUES
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004',
  'stripe_web','sandbox','cs_bind_4','sub_bind_race','server_confirmed',now()),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005',
  'stripe_web','sandbox','cs_bind_5','sub_bind_race','server_confirmed',now());
SQL

: >"$log_a"
: >"$log_b"
docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
SET ROLE service_role;
BEGIN;
SELECT allin_private.v2_bind_confirmed_subscription_purchase(
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
SET ROLE service_role;
SET lock_timeout = '7s';
SELECT allin_private.v2_bind_confirmed_subscription_purchase(
 '10000000-0000-0000-0000-000000000005');
SQL
then
  echo "CRITICAL: second owner claimed same provider purchase" >&2
  cat "$log_a" "$log_b" >&2
  exit 1
fi
wait "$pid_a"
pid_a=""
if ! grep -q 'existing purchase has different verified owner or checkout' "$log_b"; then
  echo "Second owner binding failed for an unexpected reason" >&2
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


# Two simultaneous initial trial claims must share the same DB-owned UUID,
# not create two valid seven-day trials or two Stripe idempotency keys.
docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000009');
INSERT INTO public.v2_profiles(user_id) VALUES ('00000000-0000-0000-0000-000000000009');
SQL
: >"$log_a"
: >"$log_b"
docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
SET ROLE service_role;
BEGIN;
SELECT attempt_id FROM allin_private.v2_claim_trial_checkout_attempt(
 '00000000-0000-0000-0000-000000000009',
 '00000000-0000-0000-0000-000000000009','stripe_web','sandbox');
\echo TRIAL_LOCK_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid_a=$!
ready=0
for _ in $(seq 1 50); do
  if grep -q '^TRIAL_LOCK_HELD$' "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "First account trial claim did not acquire owner lock" >&2
  cat "$log_a" >&2
  exit 1
fi
docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<'SQL'
SET ROLE service_role;
SELECT attempt_id FROM allin_private.v2_claim_trial_checkout_attempt(
 '00000000-0000-0000-0000-000000000009',
 '00000000-0000-0000-0000-000000000009','stripe_web','sandbox');
SQL
wait "$pid_a"
pid_a=""
first=$(grep -E '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' "$log_a" | head -1)
second=$(grep -E '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' "$log_b" | head -1)
if [[ -z "$first" || "$first" != "$second" ]]; then
  echo "Concurrent trial requests created separate checkout UUIDs" >&2
  cat "$log_a" "$log_b" >&2
  exit 1
fi
docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
DO $trial_unique$
BEGIN
 IF (SELECT count(*) FROM allin_private.v2_subscription_checkout_attempts
      WHERE owner_id='00000000-0000-0000-0000-000000000009'
        AND state='reserved') <> 1 THEN
   RAISE EXCEPTION 'Concurrent owner trial claim created duplicate rows';
 END IF;
END
$trial_unique$;
SQL
echo "PASS ALL-252 PostgreSQL concurrent owner trial claim same UUID"


# Renewal event and returning paid checkout must serialize on the owner.
# A renewal that commits first prevents a stale/duplicate paid checkout.
docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000011');
INSERT INTO public.v2_profiles(user_id) VALUES ('00000000-0000-0000-0000-000000000011');
SET ROLE service_role;
SELECT allin_private.v2_reserve_subscription_checkout(
 '10000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000011','stripe_web','sandbox');
SELECT allin_private.v2_register_pending_subscription_checkout(
 '10000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000011','stripe_web','sandbox','cs_11');
SELECT allin_private.v2_finalize_verified_subscription_checkout(
 '10000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000011',
 'stripe_web','sandbox','cs_11','sub_11');
SELECT allin_private.v2_apply_verified_subscription_event(
 '00000000-0000-0000-0000-000000000011',
 'stripe_web','sandbox','sub_11','evt_initial_refund_11',3,'refunded',NULL);
SQL
: >"$log_a"
: >"$log_b"
docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
SET ROLE service_role;
BEGIN;
SELECT allin_private.v2_apply_verified_subscription_event(
 '00000000-0000-0000-0000-000000000011',
 'stripe_web','sandbox','sub_11','evt_renew_11',4,'paid','2027-01-01 UTC');
\echo RENEWAL_LOCK_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid_a=$!
ready=0
for _ in $(seq 1 50); do
  if grep -q '^RENEWAL_LOCK_HELD$' "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Renewal did not acquire owner lock" >&2
  cat "$log_a" >&2
  exit 1
fi
docker exec -i "$cid" psql -XAt -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<'SQL'
SET ROLE service_role;
SELECT status FROM allin_private.v2_claim_paid_checkout_attempt(
 '00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000011','stripe_web','sandbox');
SQL
wait "$pid_a"
pid_a=""
if ! grep -q '^subscription_unresolved$' "$log_b"; then
  echo "Returning checkout raced an active renewal" >&2
  cat "$log_a" "$log_b" >&2
  exit 1
fi
docker exec -i "$cid" psql -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
DO $renewal_lock$
BEGIN
 IF EXISTS (SELECT 1 FROM allin_private.v2_subscription_checkout_attempts
            WHERE owner_id='00000000-0000-0000-0000-000000000011'
              AND offer_kind='paid') THEN
   RAISE EXCEPTION 'Duplicate paid reactivation created during renewal';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM allin_private.v2_subscription_purchases
                WHERE provider_subscription_id='sub_11' AND revision=4
                  AND phase='paid') THEN
   RAISE EXCEPTION 'Renewal was not committed before paid claim';
 END IF;
END
$renewal_lock$;
SQL
echo "PASS ALL-252 PostgreSQL renewal versus paid reactivation"
