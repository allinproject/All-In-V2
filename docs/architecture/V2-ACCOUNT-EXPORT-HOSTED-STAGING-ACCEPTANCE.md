# ALL-251 — Hosted staging acceptance for complete private export

**Current status (2026-11-12):** The founder approved and created a separate temporary Supabase staging project. Initial private-bucket provisioning and database-role isolation checks passed; full real-media/authenticated-Edge/KMS/device acceptance is still open. This is a review runbook, **not** production deployment or legal approval.

## Existing source of truth

Extend only the existing ALL-251 export request/authorization, PostgreSQL pinned canonical reader, `trainingExportPrivateMediaPages.mjs`, encrypted archive persistence, authenticated download handler and Profile download verifier. Never create a separate account export store or a public Storage link.

Current canonical source inventory reports **`complete=false`**. It must remain false until every reviewed user-owned domain, all private media and approved Community export semantics are recorded and verified. Synthetic CI uses `complete=true` only to exercise the staging transport.

## Staging prerequisites

1. Explicit approval for a **separate** Supabase project, including owner, region, costs, permitted synthetic data, least-privilege credentials and retention. Verify it is NOT V1 `impulecgsgaruvniuttc` or live V2 `xarhuczrtzuiljmtdaeu`.
2. Review exact ordered migrations, private Storage bucket policies, Auth/service grants and server-only encryption key-provider lifecycle; do not enable destructive deletion.
3. Create synthetic A/B accounts with independent active Auth sessions, a revoked session, and overlapping follow/block edges. Populate Training/Coach/EventHub/Billing plus relevant Food/Fuel/Progress domains **only as their canonical owner schemas become approved**. Avoid importing real personal data.
4. Stage private source objects: ready activity time-series and routes, cross-owner object names, missing/changed bytes, unknown media/photo bucket, duplicate path, >limit object, request cancellation and checksum-corrupted source.
5. Stage one encrypted account archive with all approved source pages, explicitly classified `private_media` binary chunks, private archive manifest, KMS-bound key and per-page integrity receipts. Confirm no public URL/service key leaks.
6. Download through actual authenticated Edge endpoint on both user sessions, then deny B reading A; deny expired/revoked requests, account switch and interrupted downloads. Validate the final digest and reconstruct each media file **byte-for-byte** on iOS and Android.
7. Prove purge of expired/cancelled archives via the Storage API, durable purge audit, orphan detection and retry alerts. Exercise synthetic account deletion with backup/PITR restore and verify no remaining source bytes.
8. Sign off Community pair-CAS privacy proposal, retention/legal-hold treatment, and actual release wording. Only then consider changing canonical `complete`, migration approval, or download availability.

## Implemented isolated acceptance

- The canonical reader and full disposable PostgreSQL replay cover owner/session isolation and snapshot consistency.
- `trainingExportPrivateMediaPages.node.test.mjs` checks bounded media-byte encryption and reconstruction, tampering, unreviewed paths and cross-owner access.
- `scripts/test-v2-account-export-real-local-storage.mjs` exercises actual **localhost** Supabase Storage API buckets, anonymous read denial, PostgreSQL catalog inventory, encrypted archive readback and cleanup in CI. It explicitly refuses non-loopback URLs.
- `docs/architecture/V2-ACCOUNT-EXPORT-COMMUNITY-RETENTION-POLICY-REVIEW.md` records the proposed minimum-disclosure policy and outstanding legal retention decision.

These are not a substitute for the independently approved **hosted** staging and native-device acceptance. Never describe review-only file handling as a shipped feature.

## Temporary hosted staging — verified baseline (2026-11-12)

- **Isolated target:** `All-In-V2-Temporary-Staging` (`fbtgknlxjyeqrxemskbl`), Longrunlog, us-east-1, ACTIVE_HEALTHY at review time. Supabase quoted an additional **$10/month**. **Never** use live V2 `xarhuczrtzuiljmtdaeu` or V1 `impulecgsgaruvniuttc` as a test target.
- **Approved temporary migration already applied ONLY to this staging project:** `all251_temporary_staging_private_buckets_no_client_policies`. Exactly two private `storage.buckets` records, `v2-private-workout-objects` and `v2-private-account-exports`, `public=false`, MIME `application/octet-stream`, 16 MiB per object. No additional Storage object access policies were granted.
- **Live staging PostgreSQL readback:** `anon` and `authenticated` roles each saw **zero** private buckets and zero objects under RLS. `service_role` saw **exactly two private buckets**. Additional transaction-rolled-back security probes attempted to create a public Storage bucket as `anon` and `authenticated`: both were denied; no unauthorized/public bucket remained. Supabase security advisor reported **zero** security lints. This checks metadata isolation, NOT a network-level byte upload/download or real Auth bearer session.
- **Existing staging state:** no user accounts or deployed Edge Functions at initial baseline. Do not claim cross-owner production Auth, Stage KMS, device file-save, or hosted binary readback acceptance from this configuration-only proof.
- **Deletion safeguard:** An enabled one-time reminder for 2026-11-13, 10:14 AM America/Chicago, automation `Automation_fdfda9a82d9c81919613bb5d53d1c48a`, names **only** staging `fbtgknlxjyeqrxemskbl`. The connected Supabase tool **does not expose project deletion**. A human must delete the temporary project using the Supabase dashboard; verify deletion before claiming billing has stopped.
- **Next execution:** Bind the server-side authenticated service client, a real key provider and approved complete source inventory; then test actual hosted file bytes, owner A/B sessions, revoked session, encrypted download, tampering, expiry, retention, PITR and iOS/Android download/share as outlined above. Never switch the canonical `complete=false` flag or grant production permissions until these pass.


## Optional credential-isolated hosted binary API rehearsal

The **existing** `scripts/test-v2-account-export-real-local-storage.mjs` now has a hosted mode restricted to the one founder-approved temporary staging ref `fbtgknlxjyeqrxemskbl`. Local disposable CI remains the default and must continue to pass unchanged.

- The hosted run requires `CI=1`, `ALL251_ALLOW_HOSTED_TEST=true`, `ALL251_HOSTED_PROJECT_REF=fbtgknlxjyeqrxemskbl`, `ALL251_HOSTED_URL=https://fbtgknlxjyeqrxemskbl.supabase.co` and **secret environment** values `ALL251_HOSTED_SERVICE_ROLE_KEY` and `ALL251_HOSTED_ANON_KEY`. Never paste or commit service credentials into source, chat, Linear, logs or test artifacts.
- The script rejects a hostname that does not exactly equal the temporary staging ref, including live V2 and V1. It does not create or delete hosted buckets. Before uploading, it checks exactly two expected private buckets and refuses pre-existing synthetic owner files. It uploads only disposable synthetic owner paths, then removes only the objects it created.
- Hosted object catalog verification uses bounded hierarchical Storage API listing rather than assuming a top-level list covers nested paths. The local default still verifies against disposable PostgreSQL `storage.objects`.
- It tests synthetic byte upload, anonymous read denial, encrypted archive stage, download and checksum, missing encrypted page denial, exact encrypted object restore and cleanup. **It uses an ephemeral test AES key and synthetic authorization adapter, not real KMS or independently authenticated sessions.** Its success is only binary Storage API acceptance, never full user export acceptance.
- The connected Supabase interface currently cannot issue service-role credentials, upload object bytes, invoke a protected Edge function or drive a physical phone. Thus the hosted branch cannot be executed by the connector alone. A separate **manual-only** workflow `.github/workflows/v2-all251-temporary-hosted-storage.yml` is staged, locked to `integration/v2-foundation` and the exact temporary project. It reads only protected GitHub secrets `ALL251_TEMP_STAGING_SERVICE_ROLE_KEY` and `ALL251_TEMP_STAGING_ANON_KEY`; neither may be taken from live V1/V2. The job fails closed if missing and never runs on push. The workflow remains unexecuted until credentials are configured by an authorized operator. Do not weaken Auth/Storage policies or publish secrets to work around that limitation.
- Never leave the staging project running after testing. The exact reminder is active for 2026-11-13 at 10:14 AM Central; actual deletion is a manual Supabase dashboard action because the connector exposes no project deletion tool.



## 2026-11-13 — real authenticated hosted Auth + private byte smoke: PASS (limited scope)

Target was **only** the founder-approved temporary staging project `fbtgknlxjyeqrxemskbl`, not live V2 or V1. The existing protected staging-only Auth workflow ran after a limited extension of its test script: [GitHub Actions #43417359225](https://github.com/allinproject/All-In-V2/actions/runs/43417359225) **SUCCESS**, source commit `fbe606e7037a78cb90cbf19d564279189e33e922`. This is real network-backed hosted evidence, not a local PostgreSQL simulation.

- Created two disposable **real GoTrue Auth sessions** using protected temporary-project credentials; both authenticated and had distinct signed JWTs.
- Using the staging server credential, uploaded 65,536 cryptographically random bytes into the existing private workout bucket under a unique synthetic owner path. Retrieved through authenticated Storage API as the trusted server, and compared full SHA-256 digests: **match**.
- Used **each** real user JWT (owner A and foreign owner B) with the publishable API key to attempt private object downloads. Both were denied (as intended because **no authenticated client Storage policies are enabled**). This proves deny-by-default and cross-owner denial; it **does not prove owner A can download authorized private bytes**.
- Existing hosted authenticated negative checks passed for client access to privileged export RPCs, requests without approval, disabled export-download handler, Auth session logout and synthetic account cleanup. Other included Food Log checks passed but do not substitute for ALL-251 acceptance.
- An independent post-run staging PostgreSQL readback found **0 Auth users, 0 Storage objects and 0 export requests**, with exactly the two approved private Storage buckets remaining. Neither temporary object bytes nor disposable Auth identities persisted.
- Current hosted access state: no installed `v2_verify_account_deletion_storage_readiness(uuid,uuid)` or upload-barrier RPC; `storage.objects` has no client access policies. Existing candidate `V2-ACCOUNT-DELETION-STORAGE-WRITE-GATE-REVIEW.sql` states that a standalone preflight is not atomic and **service/Admin Storage writers require their own fail-closed checks**. Thus **the comprehensive upload barrier is NOT ACCEPTED or deployed**.

**Still blocked, not marked complete:** positive owner-authorized private byte access; production-like authenticated owner export request plus approved canonical inventory; genuine KMS key lease and ciphertext archive/download integrity; device byte-for-byte save on iOS/Android; encrypted retention/deletion workers; mandatory upload barrier across all Storage writers (including privileged service/Admin paths) with concurrency proof; formal Community and legal/privacy acceptance; provider-side backup/restore gate ALL-12. Do not mark the canonical full export `complete=true`, turn on deletion, grant public access or ship a native file save based on this smoke.

**Lifecycle/cost:** Temporary staging is an approved extra-cost project. Its reminder remains scheduled; project deletion has NOT been executed or verified, and must not be claimed. Keep this record to preserve what was tested before staging cleanup.


## 2026-11-13 — privileged Storage writer closure, release still BLOCKED

The established `supabase/functions/_shared/trainingExportSupabaseArchive.mjs` contains the existing **privileged** account-export uploads to `v2-private-account-exports`: single encrypted envelope, encrypted paginated collection pages and final manifest. They use the server Storage client and **are not protected by ordinary Storage RLS**. Existing user-facing source-media uploads and every Admin/service/S3 path must also be inventoried before claiming a complete barrier.

The two archive adapter factories now **require** a server-supplied `withOwnerStorageWriteBarrier({ownerId,requestId,bucketId,objectPath,operation,write})`; without it construction fails closed. Both archive paths execute Storage `upload` only through the callback and require exactly one invocation. Tests cover missing/denying/forged barrier callbacks. This prevents accidental *direct* use of these adapters, but a caller-provided no-op wrapper is **not** independently trusted: acceptance must prove the provider uses a real durable DB-backed lease or equivalent gate that serializes with deletion claims across an HTTP upload. The existing `readApprovedRequestExpiry` check is not itself an atomic deletion gate. See commits `722081c`, `c66eb70`.

**Mandatory all-writer gate before release:**
1. Inventory every upload entrypoint and credential: authenticated client INSERT/UPDATE/upsert, trusted archive writers, activity/source-media writers, service/Admin paths, signed uploads, S3/multipart and any future buckets. Disable or fail close unknown privileged paths.
2. Make the actual Storage write and deletion-request transition mutually exclusive using a **durable lease/claim fence covering the whole external HTTP write** (transactional preflight is insufficient after its transaction commits). Deletion must not enter destructive processing while any active writer lease exists, and stale lease/writer failures must require reconciliation rather than silent expiry.
3. Assert exact authenticated owner/session, bucket/path, lease request identity, operation including overwrite/multipart, and post-write byte/catalog checks. Do not grant service credentials to mobile or expose lease creation as a public bypass.
4. Prove **real concurrent hosted** upload-versus-request/claim, privileged bypass attempts, revoked session, cancelled/resumed owner, race retries and object-byte absence after deletion. Only then consider controlled rollout; keep deletion worker default OFF and `completeUserExport=false` until separate export acceptance.

**No production migration, staging gate activation, broad Storage RLS grant or deletion-worker enablement occurred in this implementation.**


### Canonical writer integration (follow-up, 2026-11-13)

A subsequent repository inspection found the **already existing** owner of privileged uploads: `supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs` and `docs/architecture/sql/V2-ACCOUNT-DELETION-PRIVILEGED-STORAGE-WRITER-REVIEW.sql`. Its staged Edge entrypoint is `supabase/functions/v2-private-storage-writer/index.ts` and remains default OFF. The SQL candidate issues durable **non-expiring** per-owner leases under the canonical deletion advisory lock, refuses active deletion, and blocks entering `requested`/`processing` while any unsettled lease exists. Failure/timeout must leave the lease open for independent reconciliation.

The existing `scripts/v2-training-account-export-worker-candidate.mjs` now **constructs and reuses this canonical privileged writer**. Each encrypted envelope, paginated page, and manifest upload is performed inside its `writeWithBarrier` method: begin lease → actual Storage API upload → read back exact bytes → settle lease. Caller-provided test callbacks are **not** accepted as the real worker's source of authorization. The archive adapter's barrier callback includes the actual byte payload and operation, and denies missing or unexecuted callbacks. The canonical writer enforces an **8 MiB per-object bound**, so larger encrypted blobs/pages are blocked pending approved chunking; do not silently raise this limit. Changes: commits `5f58ada`, `93eb3a7`, `4805478`, `ec2585a`, `ddd0d65`.

**Still NOT completed:** the canonical SQL lease/claim trigger has not been installed in hosted staging or live V2, and the Edge writer remains disabled. Independent authenticated Storage client paths, server-side Admin uploads outside the canonical adapter, presigned/S3/multipart writes and future buckets have **not** been inventoried and fenced end-to-end. A direct service-role Storage upload remains possible outside this adapter. Hosted concurrency proving deletion-versus-upload serialization and unresolved-lease handling is mandatory before any release. Export download/retention and real device acceptance remain separate.
