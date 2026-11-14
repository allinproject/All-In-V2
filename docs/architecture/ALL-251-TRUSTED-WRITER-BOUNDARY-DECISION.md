# ALL-251 — Trusted private Storage writer isolation decision (staging candidate)

**Status: NOT APPROVED FOR ACTIVATION.** No production deployment, credential provisioning,
new hosted project, or release authorization is provided by this document.

## Existing ownership (do not duplicate)

- Canonical owner/deletion state and advisory lock: the existing ALL-251 database
  request/lease/settlement functions, not a second account-delete state machine.
- Canonical writer and receipt: `trainingPrivilegedStorageWriter.mjs` and
  `trainingPrivilegedStorageWriterAttestor.mjs`, including byte readback before lease
  settlement. Reuse the existing account export and deletion coordinators.
- Legacy unsigned begin/settle RPCs remain revoked for service-role. Only the
  attested bridge remains callable; a signing key must not be placed into the
  GitHub runner, mobile app, or shared Supabase Edge Function secrets.
- Real two-user HTTP acceptance:
  `scripts/test-all251-hosted-owner-rest-isolation.mjs` and its protected workflow.
  It intentionally fails without an approved *positive* trusted-writer baseline.

## Why the current staging project cannot establish exclusivity

Supabase project secret/service-role keys bypass Storage RLS. The existing
metadata fence is a staging review-only, provider-unsupported defense-in-depth
control, not durable custody of object bytes. Other authorized project-wide
privileged callers and S3/signed/TUS flows remain separate potential bypasses.

Supabase Edge Secrets are project-wide, not individual-function secrets. Merely
deploying `v2-private-storage-writer` alongside `v2-coach` and the export
function with `ALLIN_WRITER_ATTESTATION_SECRET_B64` would expose the signer to
other functions in the same project. It is *not* independent custody.

## Proposed staged isolation — architectural choice, not an executed deployment

**Preferred evaluation:** isolate protected private file bytes behind a separate
provider credential boundary (for example, a dedicated Storage project) and
make the existing canonical trusted writer the only holder of those provider
write credentials. Keep Auth/user identity and canonical deletion/lease state
owned by the existing application domain. Adapt its Storage transport and
recovery integration; **do not** duplicate owner tables or account-deletion
processes.

A dedicated signing secret alone in an external compute service is insufficient
when other holders of the original project's service-role credentials can still
write the *same* Storage bucket directly. The Storage endpoint itself must
enforce the separate credential boundary. Remove alternate privileged holders
or ensure they are cryptographically incapable of accessing the isolated
private object store.

Before selection, obtain actual vendor price and quota terms, confirm available
free-tier coverage without assuming free hosting, determine operational owner,
document backup and full byte restore, credential rotation/revocation,
data residency, outage behavior, object migration and checksum parity,
and measure client upload latency. No new subscription or paid service may be
created on this document's authority.

## Approval checklist

1. Explicit founder approval of provider/compute choice, expected cost,
   recovery procedure and any data migration.
2. Inventory every credential able to modify protected object bytes:
   Supabase secret/service-role keys, S3 keypairs, temporary CI credentials,
   signed-upload signers, TUS sessions, deployed functions, Studio/CLI operators.
   Revoke or isolate all alternate writers. Never commit secret material.
3. Provision an independent writer-only secret *outside* shared project-wide
   Edge secrets and runner environments. Verify positive and negative custody
   tests; deny key introspection to general service-role and app clients.
4. Keep verified Auth session and owner binding, exact private bucket/path,
   operation and SHA-256 digest, one-time nonce, durable lease, deletion lock,
   and settlement/readback on the canonical application system.
5. Verify migration/restore and full synthetic cleanup for private object
   bytes, user identities, leases and deletion requests.
6. Run the real protected two-account REST test (A success, B denial and
   mutation denial, immutable bytes, account-deletion fence, B independence),
   then privileged REST bypass, S3, signed URL and resumable/multipart late
   completion tests. The latter cannot be inferred from a passing RLS test.
7. Keep account-deletion worker and release gates ALL-222/ALL-251 disabled
   until all routes, legal/privacy review and recovery acceptance pass.

## Current verified limits (November 13, 2026 staging)

- Old unsigned service-role lease grants are revoked; attested RPC entrypoints
  have service-role EXECUTE, but this does not attest independent signer custody.
- `v2-private-storage-writer` is not deployed in disposable staging. The
  existing Edge writer code remains hard default-OFF.
- Existing protected GitHub test does not receive the writer signing key.
  New test code is ready; hosted positive-control acceptance remains pending.
- Repository guard `scripts/test-all251-runtime-storage-writer-inventory.mjs`
  protects reviewed staging workflow inventory and forbids the attestation
  signer from GitHub Actions secrets/vars references.
- Neither this staging policy work nor these static controls prove global
  privileged Storage exclusivity. ALL-222 / ALL-251 remain BLOCKED.
