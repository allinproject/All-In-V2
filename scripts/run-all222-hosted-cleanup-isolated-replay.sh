#!/usr/bin/env bash
# ALL-222 isolated cleanup replay; no hosted credentials, ports or network.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${ALL222_ISOLATED_REPLAY_APPROVED:-}" != "YES" ]]; then
 echo 'BLOCKED: ALL222_ISOLATED_REPLAY_APPROVED=YES required' >&2
 exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
 echo 'BLOCKED: Docker required for disposable PostgreSQL' >&2
 exit 2
fi
docker run --rm --pull=never --network=none --read-only \
 --tmpfs /tmp:rw,exec,nosuid,size=512m \
 --mount "type=bind,src=${ROOT},dst=/source,readonly" \
 --entrypoint bash postgres:16 \
 /source/scripts/fixtures/all222-hosted-cleanup-replay-inside.sh
