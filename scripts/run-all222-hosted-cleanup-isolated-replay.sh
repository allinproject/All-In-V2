#!/usr/bin/env bash
# ALL-222 isolated PostgreSQL replay for the exact hosted-termination cleanup
# candidate. Never contacts Supabase. Requires local pre-pulled postgres:16.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${ALL222_ISOLATED_REPLAY_APPROVED:-}" != "YES" ]]; then
 echo 'BLOCKED: ALL222_ISOLATED_REPLAY_APPROVED=YES required' >&2; exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
 echo 'BLOCKED: Docker required for disposable PostgreSQL' >&2; exit 2
fi
docker run --rm --pull=never --network=none --read-only \
 --tmpfs /tmp:rw,exec,nosuid,size=512m \
 --mount "type=bind,src=${ROOT},dst=/source,readonly" \
 --entrypoint bash postgres:16 -ceu '
 mkdir -p /tmp/all222pg /tmp/all222sock
 chown postgres:postgres /tmp/all222pg /tmp/all222sock
 gosu postgres initdb -D /tmp/all222pg --auth-local=trust --auth-host=reject >/dev/null
 gosu postgres pg_ctl -D /tmp/all222pg -o "-k /tmp/all222sock -c listen_addresses=" -w start >/dev/null
 trap "gosu postgres pg_ctl -D /tmp/all222pg -m immediate -w stop >/dev/null 2>&1 || true" EXIT
 export PGHOST=/tmp/all222sock PGUSER=postgres PGDATABASE=postgres
 psql_run(){ gosu postgres psql -X -v ON_ERROR_STOP=1 "$@"; }
 psql_run -q \
   -f /source/scripts/fixtures/all222-cancel-replay-bootstrap.sql \
   -f /source/docs/architecture/sql/ALL222-ATTESTED-LEASE-CANCEL-ISOLATED-REVIEW.sql \
   -f /source/scripts/fixtures/all222-hosted-cleanup-populated-replay-bootstrap.sql
 OWNER=4eac09be-9845-48db-9348-474e5c08e6e8
 LEASE=4a5c3ccc-ed0a-40fa-8e77-8324c992956e
 src=/source/scripts/fixtures/all222-hosted-termination-cleanup-dryrun-review.sql
 # Source starts from impossible IDs and is always ROLLBACK. Only substitute
 # synthetic fixed IDs into disposable ephemeral /tmp; never modify source.
 sed -e "s@SET LOCAL all222.cleanup_owner_id = .*;@SET LOCAL all222.cleanup_owner_id = '\''$OWNER'\'';@" \
     -e "s@SET LOCAL all222.cleanup_lease_id = .*;@SET LOCAL all222.cleanup_lease_id = '\''$LEASE'\'';@" \
     "$src" > /tmp/with-test-ids.sql
 psql_run -q -f /tmp/with-test-ids.sql
 preserved=$(psql_run -Atqc "SELECT count(*) FROM allin_private.v2_privileged_storage_write_leases_review WHERE lease_id='\''$LEASE'\'' AND cancelled_at IS NOT NULL")
 test "$preserved" = "1" || { echo "FAIL: dry-run did not roll back"; exit 1; }
 echo "PASS: exact synthetic cancelled lease matched; deletion rolled back"
 # Default impossible IDs must be rejected.
 if psql_run -q -f "$src" >/tmp/negative.log 2>&1; then
   echo "FAIL: impossible owner/lease IDs accepted"; exit 1
 fi
 # Non-synthetic owner cannot qualify for cleanup.
 psql_run -q -c "UPDATE auth.users SET raw_app_meta_data='\''{}'\''::jsonb WHERE id='\''$OWNER'\''"
 if psql_run -q -f /tmp/with-test-ids.sql >/tmp/negative.log 2>&1; then
   echo "FAIL: untagged owner accepted"; exit 1
 fi
 psql_run -q -c "UPDATE auth.users SET raw_app_meta_data='\''{\"all222_disposable\":true,\"all222_fixture\":\"terminate-active\"}'\''::jsonb WHERE id='\''$OWNER'\''"
 # Additional lease must prevent reconciliation.
 psql_run -q -c "INSERT INTO allin_private.v2_privileged_storage_write_leases_review(lease_id,owner_id,bucket_id,object_path,operation,expires_at) VALUES ('\''3c7c61dd-ce2e-476d-b3e6-2e81dd289878'\'','\''$OWNER'\'','\''v2-private-workout-objects'\'','\''$OWNER/other.bin'\'','\''create'\'',now()+interval '\''30 minutes'\'')"
 if psql_run -q -f /tmp/with-test-ids.sql >/tmp/negative.log 2>&1; then
   echo "FAIL: extra owner lease accepted"; exit 1
 fi
 psql_run -q -c "DELETE FROM allin_private.v2_privileged_storage_write_leases_review WHERE lease_id='\''3c7c61dd-ce2e-476d-b3e6-2e81dd289878'\''"
 # Any private object prevents reconciliation.
 psql_run -q -c "INSERT INTO storage.objects(bucket_id,name) VALUES ('\''v2-private-workout-objects'\'','\''$OWNER/present.bin'\'')"
 if psql_run -q -f /tmp/with-test-ids.sql >/tmp/negative.log 2>&1; then
   echo "FAIL: owner with present Storage bytes accepted"; exit 1
 fi
 psql_run -q -c "DELETE FROM storage.objects WHERE name='\''$OWNER/present.bin'\''"
 # An ordinary deletion request record prevents reconciliation.
 psql_run -q -c "INSERT INTO allin_private.v2_account_deletion_requests(user_id,status) VALUES ('\''$OWNER'\'','\''completed'\'')"
 if psql_run -q -f /tmp/with-test-ids.sql >/tmp/negative.log 2>&1; then
   echo "FAIL: deletion request present but cleanup accepted"; exit 1
 fi
 psql_run -q -c "DELETE FROM allin_private.v2_account_deletion_requests WHERE user_id='\''$OWNER'\''"
 # A lease not cancelled is ineligible.
 psql_run -q -c "UPDATE allin_private.v2_privileged_storage_write_leases_review SET cancelled_at=NULL WHERE lease_id='\''$LEASE'\''"
 if psql_run -q -f /tmp/with-test-ids.sql >/tmp/negative.log 2>&1; then
   echo "FAIL: active lease accepted"; exit 1
 fi
 psql_run -q -c "UPDATE allin_private.v2_privileged_storage_write_leases_review SET cancelled_at=now() WHERE lease_id='\''$LEASE'\''"
 preserved=$(psql_run -Atqc "SELECT count(*) FROM allin_private.v2_privileged_storage_write_leases_review WHERE lease_id='\''$LEASE'\''")
 test "$preserved" = "1" || { echo "FAIL: lease removed during negative replay"; exit 1; }
 echo "PASS: impossible IDs, untagged owner, extra lease, existing object, deletion record and active lease all rejected"
 echo "PASS: isolated cleanup replay completed; container discarded"
 '
