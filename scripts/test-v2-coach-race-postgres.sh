#!/usr/bin/env bash
# ALL-217: true two-connection request claim replay on disposable PG17 only.
set -euo pipefail
: "$POSTGRES_CONTAINER_ID"
: "$PGUSER"
[[ "$PGUSER" == postgres ]] || { echo 'Refusing non-test role'; exit 2; }
cid="$POSTGRES_CONTAINER_ID"; db=allin_coach_race_test
a="$(mktemp)"; b="$(mktemp)"; pid=""
cleanup(){ if [[ -n "$pid" ]];then wait "$pid" || true;fi;rm -f "$a" "$b"; }
trap cleanup EXIT

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
