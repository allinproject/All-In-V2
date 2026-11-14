# ALL-251 — Hosted staging activation and A/B acceptance

2026-11-14 UTC. **No production use.** This file records live evidence and
remaining deployment requirements; it does not grant authority to set
`uploadBarrierEnforced=true`, deploy a writable public Worker, or operate
against real users. The current Worker is intentionally deny-only.

## Completed on disposable staging (verified 2026-11-14 UTC)

Supabase project `fbtgknlxjyeqrxemskbl`:
- Previously deployed attested begin and settle functions exist in public,
  execute by service_role only, and the legacy *unsigned* begin/settle
  functions are not executable by anon, authenticated, or service_role.
- The dedicated private writer key table contains a provisioned 32-byte
  signer, and nonce table exists with historical receipts. **A DB key's
  presence does not establish independently protected Cloudflare custody.**
- Newly applied migration
  `all251_staging_worker_session_check_20261114` installed only
  `public.v2_all251_worker_session_check_review()`. Grants verified:
  authenticated EXECUTE true; anon and service_role false. Its body uses
  signed `auth.uid()`, JWT session_id and existing
  `allin_private.v2_account_export_authorize_session_candidate`,
  which checks `auth.users`, live `auth.sessions`, `not_after` and
  canonical account-deletion requests. A direct authenticated role with
  missing JWT claims was denied in a rollback-only SQL test.
- No ALL-251 synthetic Auth users and no unsettled privileged leases were
  present at verification. No secret values were read or output.
- Supabase Security Advisor reports the authenticated SECURITY DEFINER
  function as an expected **review warning**, requiring an intentional
  least-privilege/security audit; do not broadly grant EXECUTE to new roles.
- The new SQL migration is **staging-only**. Do not infer or create a
  production migration from the live staging state.

## Other existing resources

Cloudflare account has staging Worker `allin365-storage-staging`,
private R2 bucket `allin365-private-staging`, and `PRIVATE_STORAGE`
binding, created by the founder. The current Worker endpoint
`https://allin365-storage-staging.durbenventures.workers.dev/`
was founder-confirmed to return default-deny `STORAGE_NOT_READY`.
GitHub review-only code is NOT deployed to this Worker.

## Gate 1 — Real A/B authenticated session behavior

Source: `scripts/test-all251-hosted-worker-session-gate.mjs`.
Protected workflow:
`.github/workflows/v2-all251-hosted-worker-session-gate.yml`.
It uses only the existing protected disposable
`all251-temporary-staging` environment's service and publishable keys.
No additional GitHub secret is required for this session-only test.

After the workflow and script are independently reviewed and available on
`integration/v2-foundation`, the repository owner may dispatch the
workflow manually and approve the protected staging environment. Do NOT
remove the integration branch restriction or merge the entire draft
PR #18 merely to run this test. Preferred: promote only the isolated,
reviewed test files through the normal PR/branch protection process.

The test creates two disposable synthetic Auth users; logs in each through
the **real** Auth HTTP API; checks both sessions positively through the
new RPC; checks anon and service-role access denied; checks that B cannot
request A deletion; requests A deletion from A's actual session; confirms
A session rejected while B continues; revokes B session and verifies
rejection; then deletes only the two synthetic Auth users. Failure to
clean up is visible. **It has not run as of this record.**

This is session acceptance, NOT R2 Storage or signed lease acceptance.

## Gate 2 — Independent signing custody and restricted deployment

The existing DB HMAC signer is already provisioned. Do NOT generate a
new unrelated Worker signer or paste secret material into a chat,
issue, GitHub repository or logs. The existing secret value is **not
available** through connected staging tools. The Cloudflare Worker needs
the EXACT matching 32-byte key. If the original key is not recoverable
from an already approved private operator vault, coordinate a **staging-only
rotation** with zero unsettled leases, verified backup/restore,
an exclusive trusted operator, and a verified atomic cutover. Do not
overwrite the key while any signer or in-flight lease may use it.

Cloudflare Worker secrets must be managed in Worker Settings → Variables
and Secrets or secure operator tooling. No secrets may be attached to
public build artifacts, GitHub PR CI or Supabase project-wide Edge
secrets. Candidate runtime names (do not set until reviewed):
`ALLIN_WRITER_ATTESTATION_SECRET_B64` for the matched HMAC and a
separately managed `ALL251_STAGING_PRIVILEGED_KEY` for the scoped
attested RPC client. Note: the latter `sb_secret_` key remains broad
at the Supabase provider layer. Code allowlisting two RPC names does
**not** reduce the key's underlying privilege. Prefer a truly scoped
backend credential/identity when supported and validated; do not
represent unrestricted keys as least privilege.

Check strong MFA, Cloudflare Worker code deployment permission,
R2 binding scope, no S3 token, no public R2 URL, auditing/retention
and key rotation. Check GitHub staging branch/reviewer restrictions
from actual settings before using any protected secrets.

## Gate 3 — Worker deployment and real private R2 uploads

Public `worker.mjs` must stay deny-only until the handler, identity,
session, scoped attested RPC, byte-limited ingress, and R2 adapter
have been independently reviewed as one trusted runtime.
Existing `infra/cloudflare/all251-storage-staging/*review*` modules
are source-only, not a supported direct deployment package.

A controlled staging rollout must prove, with **real R2 provider bytes**:
- A and B are independently authenticated and have active sessions;
  A/B pre-freeze private upload and SHA-256 readback succeed through the
  canonical attested lease writer (no direct R2 or S3 upload token).
- A requests deletion with a genuine A Auth session while B remains
  active; new A lease acquisition is denied and no new A R2 bytes appear.
  B continues with fresh verified bytes.
- An already in-flight A upload cannot commit after the accepted deletion
  boundary without a durable lease that postpones deletion; test race,
  timeouts, pending writes and unverified leases.
- Cross-owner reads/writes and attempts to use another user's path are
  rejected after positive controls, not merely blanket 403.
- Replay, incorrect SHA, expired and forged HMAC signatures and old
  unsigned lease endpoints are rejected.
- Unproven signed URL, TUS, multipart, S3 master credential routes
  remain RESTRICTED/UNTESTED; never convert them to PASS merely because
  those protocols are absent in the new Worker. Existing Supabase Storage
  paths and old media have their own explicit migration/retirement gate.
- Cleanup inventory includes real R2 bytes, account-owned metadata,
  open leases, multipart sessions and synthetic Auth users.
  Unknown or nonterminable sessions must block deletion and be retained
  for operator reconciliation rather than silently purged.

## Release and cost controls

Do not set `uploadBarrierEnforced=true`, activate private Storage
account deletion, or merge unvalidated code into production.
ALL-222 recovery/release gates remain intact. R2 and Worker usage is
subject to existing Cloudflare free-tier allowances and overage charges;
avoid test loops and extra data beyond tiny disposable byte fixtures.
Account deletion must stay disabled until independent hosted proof,
recovery acceptance and legal/privacy review all succeed.

### Evidence

- Existing review branch: draft
  https://github.com/allinproject/All-In-V2/pull/18
- Session RPC activation: live staging migration
  `all251_staging_worker_session_check_20261114`
- No-secret review workflow:
  `.github/workflows/v2-all251-hosted-matrix-offline-review.yml`
- Manual protected A/B session workflow:
  `.github/workflows/v2-all251-hosted-worker-session-gate.yml`
