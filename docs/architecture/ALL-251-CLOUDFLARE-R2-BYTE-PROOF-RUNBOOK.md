# ALL-251 — Cloudflare R2 provider byte-proof operator runbook

**Hosted synthetic R2 byte proof passed. The staging proof switch is off.**
Cloudflare version `490cba46-50fe-4620-829e-55537ecb58c9` contains the
candidate code from `ae308df22a96205e32daa8244df2cf5d3b9d49af`.
The operator reported HTTP 403 for the root, readiness HEAD, and unauthenticated
upload after deployment. Prior deny-only rollback version:
`0dcfcef5-cfbd-4f39-afa0-ae503f3ba086`. Account deletion remains off.

## Verified preparation

- Existing private R2 bucket `allin365-private-staging` with binding
  `PRIVATE_STORAGE` on `allin365-storage-staging` (founder verified).
- The original rollback entry `worker.mjs` returns only 403.
- Offline isolated R2 candidate `worker-r2-proof-candidate.mjs` uses real
  existing canonical HMAC writer, owner-JWT RPC, durable deletion lease,
  create-only atomic R2 conditional writes and provider-byte readback.
- Synthetic-only POST `/v1/workouts/:uuid` requires a verified Supabase
  Auth synthetic account (`app_metadata.all251_httpmatrix=true` and
  `all251-http-*@example.invalid`), a separate live session/deletion
  check, matched HMAC and validated owner-derived key.
- Synthetic-only GET `/v1/workouts/:uuid/checksum` returns **only** SHA-256
  and byte length after real account/session validation. No raw file bytes
  or unrestricted read, multipart, presign or S3 endpoint exposed.
- Synthetic-only DELETE `/v1/workouts/:uuid` is permitted ONLY for an
  authenticated synthetic owner with an existing `requested` deletion
  fixture and zero unsettled leases. The Worker confirms the object is
  absent after R2 deletion; it cannot delete arbitrary account data.
- Guarded HEAD `/__all251_proof_ready` returns 204 only after explicit
  proof activation plus valid-format signer and publishable key. The
  protected test runner preflights this before creating any users.
- The candidate is DISABLED by default: it returns 403 unless an explicit
  staging-only environment switch is set. It is not imported by the live
  `worker.mjs`.
- `wrangler.proof.jsonc` records the same Worker and R2 binding, but does
  not set the activation switch. CI `wrangler deploy --dry-run` built
  successfully without Cloudflare credentials; no cloud deployment.
- Matching private HMAC key exists in disposable Supabase staging; current
  Worker secret custody is **not proven**. A new, unrelated key would
  cause signed lease failures. Existing unsigned lease grants remain
  revoked.
- Two narrow staging-only `public.v2_all251_owner_attested_{begin,settle}_review`
  JWT wrappers were installed by migration
  `all251_staging_owner_jwt_attested_leases_20261114`, using the existing
  signed lease functions and canonical Auth/deletion data. Verified:
  `authenticated` EXECUTE only; anon/service_role denied; absent
  authenticated JWT refused. This replaces any need for a broad
  `sb_secret_` key in the Cloudflare runtime. Pending review:
  real owner JWT + HMAC signed begin/settle during hosted upload.

## Manual private deployment prerequisites

1. Verify the Cloudflare account is protected with MFA; R2 bucket has **no
   public URL, custom domain or S3 write token**; current Worker still
   returns deny-only. Verify the operator can roll back its prior version
   in Cloudflare dashboard.
2. Check source at draft [PR #18](https://github.com/allinproject/All-In-V2/pull/18),
   specifically `worker-r2-proof-candidate.mjs`, the owner JWT wrapper,
   `internal-writer-review.mjs`, canonical writer, R2 adapter and
   `wrangler.proof.jsonc`. No general account uploads allowed.
3. On the **operator's own secured machine** use a separate clean checkout
   of the exact reviewed PR head. Never switch branches over unstaged
   unrelated work. From repo root, run:
   `npx --yes wrangler@4.136.0 deploy --dry-run --config infra/cloudflare/all251-storage-staging/wrangler.proof.jsonc`
   The command builds only; no credentials, billed deployment or live
   Worker changes. CI already passed this same dry-run.
4. Inside the operator's authenticated Supabase SQL Editor for the exact
   disposable staging project, obtain the existing **single** private
   HMAC signer value directly using:
   `SELECT encode(secret,'base64') FROM allin_private.v2_privileged_storage_writer_key_review WHERE singleton=true;`
   Copy the result **directly** to Cloudflare Worker secret
   `ALL251_WRITER_SIGNER_B64`. Never paste into ChatGPT, GitHub,
   browser screenshots, emails or terminal history. Do not generate a new
   signer or read the value via automated assistant tools. Confirm the
   original 32-byte value remains unchanged in DB.
5. Configure `SUPABASE_PUBLISHABLE_KEY` as a **Cloudflare Worker secret**
   (a publishable, not service key), so Wrangler deployment will preserve it. `SUPABASE_URL` is the pinned
   disposable staging URL in the Wrangler proof config. DO NOT configure
   `ALL251_STAGING_PRIVILEGED_KEY`, any `sb_secret_` key, S3 master
   token, or production credentials in this Worker.
6. With source and rollback reviewed, deploy only the candidate using
   `npx --yes wrangler@4.136.0 deploy --config infra/cloudflare/all251-storage-staging/wrangler.proof.jsonc`
   from the approved operator's authenticated Wrangler session.
   **Before activation**, do not set
   `ALL251_ENABLE_SYNTHETIC_PROOF`; all requests should remain 403.
7. After verifying exact Worker version, binding, credentials, rollback
   and synthetic-only routing, manually set the staging-only Worker
   variable `ALL251_ENABLE_SYNTHETIC_PROOF=synthetic-proof-reviewed`
   (separate explicit operator action). A successful HTTP upload remains
   impossible without a legitimate synthetic Auth user JWT and a signed
   lease. Deploying this variable may create a new Worker version.
8. Confirm HEAD `/__all251_proof_ready` returns 204 only after the
   explicit activation switch. A 403 means the protected hosted runner
   must abort BEFORE creating any synthetic Auth users.
9. For rapid rollback, disable the switch / revert to the prior
   default-deny Worker version using Cloudflare's deployment controls;
   independently verify HTTP 403 on all methods. Do not rotate the
   database signer while any lease remains open.

## Hosted R2 proof

[GitHub attempt 2](https://github.com/allinproject/All-In-V2/actions/runs/43556336586/attempts/2)
verified synthetic A/B uploads, matching SHA-256 and byte length, cross-owner
checksum denial, A's post-freeze read and write denials, continued B access,
and fixture cleanup. Cloudflare's Objects view showed an empty staging bucket
afterward. Wrangler confirmed version `490cba46-50fe-4620-829e-55537ecb58c9`
restored at 100% traffic. A fresh HTTP probe after rollback is pending.
Provider bypass and the in-flight deletion race still require hosted evidence.

### Procedure for a future approved run

Once the operator completes steps 1–7 and verifies the deployed endpoint,
run a separately approved protected disposable staging HTTP test:
- Create two ephemeral `all251_httpmatrix` accounts A/B and obtain their
  actual JWTs using Supabase Auth; never print JWTs.
- POST random disposable byte payloads A/B to the trusted Worker; require
  201 and an attested settled lease.
- GET each corresponding owner-only `checksum` route; require SHA-256 of
  exact originally sent bytes and correct length. Require B's request to
  read A's UUID to yield no file.
- Request synthetic A account deletion through the existing authenticated
  staging-only RPC. A's new POST and checksum must fail; B must still
  POST fresh bytes and read back the verified digest.
- Exercise invalid sessions, bad signatures, attempted replay, unsigned
  lease paths and R2 cleanup/recovery; unresolved leases remain blocking.
- After testing, freeze each synthetic account, prove zero unsettled
  leases, DELETE only its own synthetic objects through the guarded
  cleanup route and require R2 HEAD to confirm absence. Then remove
  each synthetic deletion request and Auth user. If R2 absence cannot be
  confirmed for an owner, keep that synthetic Auth user and deletion freeze
  available for recovery. An open lease or cleanup denial fails the run.
- The protected test source is
  `scripts/test-all251-hosted-r2-byte-proof.mjs` and its manual-only
  `v2-all251-hosted-r2-byte-proof.yml` workflow. Like the earlier
  session workflow, GitHub will NOT show a Run workflow button until
  the workflow exists on the default branch; use a separately reviewed
  exact-path one-time integration push trigger only AFTER the Worker
  is verified active. No trigger/marker is currently approved.
- A passing sequential R2 upload/delete test does not cover the in-flight deletion race.
- For the hosted race, pause synthetic A after its attested lease begins and
  before its R2 write completes. A slow request body cannot prove this
  ordering because the Worker reads the entire body before lease acquisition.
  Use an isolated staging harness with a bounded, fail-closed pause and no
  public pause control. Confirm the lease is open before freezing A. Require
  cleanup to be denied while the lease is open, resume the write, confirm the
  resulting state and lease settlement, then clean up and reconcile the bucket.
  If the harness cannot confirm that ordering, report the race as unverified.

All testing remains disposable. Do not treat offline CI, a worker deploy,
201 status alone, or a checksum read without owner/session checks as
account deletion release acceptance. `uploadBarrierEnforced=false`.
