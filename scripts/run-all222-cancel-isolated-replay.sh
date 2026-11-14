#!/usr/bin/env bash
# ALL-222 cancellation SQL acceptance: isolated local PostgreSQL ONLY.
# Uses one disposable container, no network, no ports and a read-only repo mount.
# NEVER run the candidate SQL against real Supabase or a populated database.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${ALL222_ISOLATED_REPLAY_APPROVED:-}" != "YES" ]]; then
  echo 'BLOCKED: set ALL222_ISOLATED_REPLAY_APPROVED=YES for disposable local replay' >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo 'BLOCKED: Docker is required locally for the disposable PostgreSQL replay' >&2
  exit 2
fi
# Never auto-pull an image or use a host/network database.
docker run --rm --pull=never --network=none --read-only \
  --tmpfs /tmp:rw,exec,nosuid,size=512m \
  --mount "type=bind,src=${ROOT},dst=/source,readonly" \
  --entrypoint bash postgres:16 -ceu '
    mkdir -p /tmp/all222pg /tmp/all222sock
    chown postgres:postgres /tmp/all222pg /tmp/all222sock
    gosu postgres initdb -D /tmp/all222pg --auth-local=trust --auth-host=reject >/dev/null
    gosu postgres pg_ctl -D /tmp/all222pg -o "-k /tmp/all222sock -c listen_addresses=" -w start >/dev/null
    trap "gosu postgres pg_ctl -D /tmp/all222pg -m immediate -w stop >/dev/null 2>&1 || true" EXIT
    PGHOST=/tmp/all222sock PGUSER=postgres PGDATABASE=postgres \
      gosu postgres psql -X -v ON_ERROR_STOP=1 \
       -f /source/scripts/fixtures/all222-cancel-replay-bootstrap.sql \
       -f /source/docs/architecture/sql/ALL222-ATTESTED-LEASE-CANCEL-ISOLATED-REVIEW.sql \
       -f /source/scripts/fixtures/all222-cancel-replay-assertions.sql
    echo "PASS: disposable SQL state-machine replay completed; container discarded on exit"
  '
