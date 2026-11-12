#!/usr/bin/env bash
# ALL-217: true two-connection request claim replay on disposable PG17 only.
set -euo pipefail
: "$POSTGRES_CONTAINER_ID"
: "$PGUSER"
[[ "$PGUSER" == postgres ]] || { echo 'Refusing non-test role'; exit 2; }
cid="$POSTGRES_CONTAINER_ID"; db=allin_coach_race_test
a="$(mktemp)"; b="$(mktemp)"; thread_a="$(mktemp)"; thread_b="$(mktemp)"; pid=""
cleanup(){ if [[ -n "$pid" ]];then wait "$pid" || true;fi;rm -f "$a" "$b" "$thread_a" "$thread_b"; }
trap cleanup EXIT

# Two authenticated sessions simulate separate devices racing to open Coach.
# They deliberately present different candidate UUIDs; both must receive the
# single owner-canonical thread ID, with exactly one durable thread row.
docker exec -i "$cid" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$thread_a" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.v2_coach_create_thread(
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222');
\\echo COACH_THREAD_LOCK_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid=$!
ready=0
for _ in $(seq 1 50);do
 if grep -q '^COACH_THREAD_LOCK_HELD "$cid" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$a" 2>&1 <<'SQL' &
SET ROLE service_role;
BEGIN;
SELECT public.v2_coach_claim_turn(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 repeat('a',64))->>'action';
\echo COACH_CLAIM_LOCK_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid=$!
ready=0
for _ in $(seq 1 50);do
 if grep -q '^COACH_CLAIM_LOCK_HELD$' "$a";then ready=1;break;fi
 if ! kill -0 "$pid" 2>/dev/null;then break;fi
 sleep 0.1
done
if [[ "$ready" != 1 ]];then
 echo 'First claim never acquired transaction lock' >&2;cat "$a" >&2;exit 1
fi

docker exec -i "$cid" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$b" 2>&1 <<'SQL'
SET ROLE service_role;
SET lock_timeout='7s';
SELECT public.v2_coach_claim_turn(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 repeat('a',64))->>'action';
SQL
wait "$pid";pid=""
if [[ "$(grep -c '^claimed$' "$a" || true)" != 1 ||
      "$(grep -c '^wait$' "$b" || true)" != 1 ]];then
 echo 'Duplicate claim or missing independent wait' >&2;cat "$a" "$b" >&2;exit 1
fi

docker exec -i "$cid" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
do $verify$
begin
 if (select count(*) from allin_private.v2_coach_turn_claims
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and client_request_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1 then
  raise exception 'Concurrent claim generated duplicate requests';
 end if;
 if not exists(select 1 from allin_private.v2_coach_turn_claims
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and client_request_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
   and execution_version=1 and status='processing') then
  raise exception 'Second claimant changed first execution fence';
 end if;
end;
$verify$;
SQL
echo 'PASS ALL-217 true PostgreSQL two-session claim/wait race'
 "$thread_a";then ready=1;break;fi
 if ! kill -0 "$pid" 2>/dev/null;then break;fi
 sleep 0.1
done
if [[ "$ready" != 1 ]];then
 echo 'First owner-thread transaction never acquired its lock' >&2;cat "$thread_a" >&2;exit 1
fi

docker exec -i "$cid" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$thread_b" 2>&1 <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL lock_timeout='7s';
SELECT public.v2_coach_create_thread(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333');
COMMIT;
SQL
wait "$pid";pid=""
canonical_thread='22222222-2222-4222-8222-222222222222'
if [[ "$(grep -cFx "$canonical_thread" "$thread_a" || true)" != 1 ||
      "$(grep -cFx "$canonical_thread" "$thread_b" || true)" != 1 ||
      "$(grep -cFx '33333333-3333-4333-8333-333333333333' "$thread_b" || true)" != 0 ]];then
 echo 'Different first-open UUIDs did not converge to one owner thread' >&2
 cat "$thread_a" "$thread_b" >&2;exit 1
fi

docker exec -i "$cid" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
DO $thread_verify$
BEGIN
 IF (SELECT count(*) FROM public.v2_coach_threads
     WHERE user_id='11111111-1111-4111-8111-111111111111') <> 1
    OR (SELECT id FROM public.v2_coach_threads
        WHERE user_id='11111111-1111-4111-8111-111111111111')
       IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid
 THEN RAISE EXCEPTION 'Concurrent first-open created more than one persistent thread'; END IF;
END;
$thread_verify$;
SQL

docker exec -i "$cid" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$a" 2>&1 <<'SQL' &
SET ROLE service_role;
BEGIN;
SELECT public.v2_coach_claim_turn(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 repeat('a',64))->>'action';
\echo COACH_CLAIM_LOCK_HELD
SELECT pg_sleep(3);
COMMIT;
SQL
pid=$!
ready=0
for _ in $(seq 1 50);do
 if grep -q '^COACH_CLAIM_LOCK_HELD$' "$a";then ready=1;break;fi
 if ! kill -0 "$pid" 2>/dev/null;then break;fi
 sleep 0.1
done
if [[ "$ready" != 1 ]];then
 echo 'First claim never acquired transaction lock' >&2;cat "$a" >&2;exit 1
fi

docker exec -i "$cid" psql -XAt -U postgres -d "$db" -v ON_ERROR_STOP=1 >"$b" 2>&1 <<'SQL'
SET ROLE service_role;
SET lock_timeout='7s';
SELECT public.v2_coach_claim_turn(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 repeat('a',64))->>'action';
SQL
wait "$pid";pid=""
if [[ "$(grep -c '^claimed$' "$a" || true)" != 1 ||
      "$(grep -c '^wait$' "$b" || true)" != 1 ]];then
 echo 'Duplicate claim or missing independent wait' >&2;cat "$a" "$b" >&2;exit 1
fi

docker exec -i "$cid" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
do $verify$
begin
 if (select count(*) from allin_private.v2_coach_turn_claims
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and client_request_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1 then
  raise exception 'Concurrent claim generated duplicate requests';
 end if;
 if not exists(select 1 from allin_private.v2_coach_turn_claims
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and client_request_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
   and execution_version=1 and status='processing') then
  raise exception 'Second claimant changed first execution fence';
 end if;
end;
$verify$;
SQL
echo 'PASS ALL-217 true PostgreSQL two-session claim/wait race'
