# ALL-222 / ALL-251 — authorized interrupted-upload cancellation design

**Review-only; not a deployed migration.** This describes the missing canonical
operation needed before the delayed TUS-completion test can be meaningful.
The staging test file is intentionally fail-closed until implementation and
isolated proof. No production or disposable staging DDL is authorized here.

## Evidence / why the existing scenario cannot run

On 2026-11-14, the operator-run, unleased TUS initiation before deletion
returned **HTTP 403** (expected under the current attested Storage fence).
The test was **inconclusive**, not a deletion-lock PASS.

Read-only inspection of the actual staging SQL showed:

* `v2_begin_privileged_storage_write_attested_review` verifies owner,
  scoped HMAC/nonce, then opens an attested lease.
* The private Storage metadata write fence requires **exactly one current,
  unsettled, unexpired** attested lease and no deletion request.
* `v2_deny_deletion_with_open_storage_leases_review` and
  `v2_deny_auth_delete_with_open_storage_leases_review` both reject any
  `settled_at IS NULL` lease **regardless of expiration**.
* `v2_settle_privileged_storage_write_attested_review` verifies the
  attestation, but its delegated base settlement marks `settled_at=now()`
  without checking provider bytes. Settling a still-incomplete upload
  purely to clear the deletion fence would misclassify abandonment
  as success. Never use that shortcut.
* Provider TUS URL creation/HEAD are independent from the lease row;
  authenticated B's HEAD on A's unfinished session returned **200**,
  while B's append PATCH returned **403**, and DELETE against the completed
  session returned **403** with HEAD still **200**. Byte mutation by B
  was not shown, but session metadata isolation/cancellation remain unproven.

## Canonical operation to extend (not a parallel lease system)

Implement attested **cancel / abandon** of a named, unfinished,
in-scope lease in the same writer authority and existing
`allin_private.v2_privileged_storage_write_leases_review` lifecycle.

1. Support `cancel` in the same `v2-writer-v1` scoped HMAC protocol,
   with a fresh one-time nonce, verified signer, owner, bucket, path,
   operation, digest, *exact lease ID*, and short clock skew; only a
   trusted service caller can invoke the cancellation RPC. The client
   must not receive signing capability or service credentials.
2. Track cancellation separately from successful settlement, e.g.
   `cancelled_at` and a reason with minimal non-sensitive audit detail.
   Maintain **mutually exclusive** terminal states:
   `settled_at` XOR `cancelled_at`. Do not overwrite a settled lease.
3. Acquire the identical per-owner
   `pg_advisory_xact_lock(hashtextextended('v2-delete-request:'||owner,0))`
   before changing lease state. Verify the lease was validly created,
   exactly matches the attested payload, and is still unresolved.
   Consume nonce atomically; reject replay, double cancellation and
   cross-owner requests.
4. Close new Storage writes immediately at cancellation, including the
   matched writer `INSERT`/`UPDATE` metadata path. Review every writer,
   deletion fence and open-lease inventory predicate so that cancelled
   leases do not count as open, while **no** cancelled lease authorizes
   writes. Do not treat merely expired, still-open leases as safe for
   deletion: explicit revocation and provider-session proof are required.
5. Cancellation of the database lease **does not by itself revoke the
   provider TUS upload URL or pre-minted signed capability**. The
   account deletion request must continue to deny final object
   creation even if the URL remains accessible. This needs real HTTP
   testing under existing RLS and service-only storage fence.
6. A TUS cancellation is not proof that transient bytes or session
   metadata have disappeared. Distinguish database-lease terminal
   state, Storage object byte+metadata absence and provider upload
   session expiry or invalidation in acceptance evidence. If the
   provider has no reliable hard revocation, keep direct private
   resumable uploads disabled and require a server-controlled gateway
   that checks current deletion state on *every* HEAD/PATCH/finalize.
7. Recovery/cleanup of a synthetic cancellation must be idempotent and
   never remove another user's sessions/objects or silently unlock a
   real deletion request. Include operation-specific audit evidence
   without exposing user identifiers, bearer URLs or signing material.

## Required isolated acceptance sequence

1. Begin a real, owner-specific attested lease for the exact test object.
2. Mint an owner-authorized TUS session under that lease. Upload a
   **partial** chunk, and independently verify its offset, without
   completing an object. Prepare signed-upload capability under a
   separate legitimate lease as needed.
3. Cancel/abandon those **unfinished** leases with the new signed
   cancellation operation. Verify the lease is terminal **cancelled**,
   not **settled**, and no visible file bytes/object metadata exist.
4. Make an actual synthetic deletion request through the *existing*
   disposable-owner-only `v2_all251_http_matrix_request_deletion` RPC;
   prove the authenticated request succeeded while any new attested
   lease issuance is blocked.
5. From the original still-held session URLs, attempt delayed
   owner-token TUS PATCH, signed PUT, ordinary POST, and across-account
   HEAD/PATCH. None may complete a private object or expose private
   cross-account session metadata. Record numeric statuses only;
   assert provider-confirmed byte and metadata absence.
6. Verify the remaining provider TUS session is invalid or expired
   with a reliable independent probe; if HEAD remains 200 or
   termination is unsupported, session lifecycle gate remains FAIL.
7. Cleanup only the synthetic deletion row, files, cancelled leases,
   and synthetic Auth accounts, proving 0 leftover Auth users, objects,
   unresolved leases, active deletion rows and ideally upload sessions.
   Run a final stale-session probe before calling this a full PASS.

**Do not** treat an unleased 403, a database-only 0-row inventory, expired
but unresolved leases, or an artificially settled partial upload as proof
of delayed-completion protection.

Release gates: `uploadBarrierEnforced=false`,
`completePrivateStorage=false`; account deletion worker OFF. PR #25
remains draft, ALL-222 / ALL-251 remain open.


## Offline disposable PostgreSQL replay — added, not yet executed

The source-controlled local replay harness consists of:

- `scripts/run-all222-cancel-isolated-replay.sh`
- `scripts/fixtures/all222-cancel-replay-bootstrap.sql`
- `docs/architecture/sql/ALL222-ATTESTED-LEASE-CANCEL-ISOLATED-REVIEW.sql`
- `scripts/fixtures/all222-cancel-replay-assertions.sql`

It starts a **new empty PostgreSQL 16 container**, with `--network=none`,
`--read-only`, a tmpfs-only database and a read-only repository mount.
It does not use remote PostgreSQL credentials or the independent production
writer signer, and does not open a port. It does not automatically pull a
Docker image. The container is destroyed after execution. Use only an
isolated, reviewed PR checkout and the exact current branch files.

Run from the repository root *only if Docker and postgres:16 are already
present and approved*:

```bash
ALL222_ISOLATED_REPLAY_APPROVED=YES bash scripts/run-all222-cancel-isolated-replay.sh
```

This is **NOT** an instruction to run against a Supabase-hosted database.
If the image is unavailable, stop. Do not substitute hosted SQL execution.
A failure should be investigated before rerunning.

The fixture starts from synthetic roles, schemas, Auth owners and leases,
then applies the candidate SQL and asserts cancellation state transitions,
replay rejection, HMAC verification, wrong-owner denial, completed-object
protection, mutual exclusion, privilege restrictions, existing deletion
guard and metadata writer fence. These tests do **not** cover actual
provider TUS sessions, concurrent cross-session races, populated migration
compatibility, or real Storage HTTP routes. Those remain separate gates.

**As of the current update, the replay harness was committed and read back
from GitHub, but has not been executed on PostgreSQL. No database PASS
is claimed.**
