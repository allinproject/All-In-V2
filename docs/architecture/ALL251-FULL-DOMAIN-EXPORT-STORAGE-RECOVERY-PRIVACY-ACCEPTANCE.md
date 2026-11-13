# ALL-251 / ALL-12 / ALL-219 — account portability, media erasure, recovery and privacy acceptance

Status: **Acceptance evidence in progress — NOT release approval.** Last scoped review: 2026-11-13. This supplements existing canonical ALL-251 architecture docs and the V1 Founder Beta Legal Package (Working Draft), rather than replacing them. No data-retention days, legal grounds, KMS setup or final privacy position are fabricated.

## Owning implementation and sources

- Existing source inventory/page SQL: `docs/architecture/sql/V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql`, pinned PG reader and `v2-training-account-export-worker-candidate.mjs`. Preserve its `complete=false` release gate until **every** real source and media byte is accounted for.
- Existing archive/KMS path: `trainingExportLargeArchive.mjs`, `trainingExportPrivateMediaPages.mjs`, `trainingExportAwsKms.mjs` and canonical authenticated download handler. Test keys are never real KMS acceptance.
- Existing Storage removal: `trainingDeletionPrivateStorageReview.mjs`, durable checkpoint and write-lease reviews, `trainingDeletionOperationalStorageReadiness.mjs`, and default-OFF deletion worker. SQL metadata absence is not API-byte absence.
- Existing recovery: `scripts/all12-recovery-domain-manifest.mjs` and ALL-12 populated Auth, domain and private Storage restoration acceptance.
- Existing privacy owner: `docs/architecture/V2-ACCOUNT-EXPORT-COMMUNITY-RETENTION-POLICY-REVIEW.md` and ALL-219 V1-sourced founder-beta legal package. **No legal approval is asserted**.

## Acceptance ledger

| Gate | Evidence expected | Explicit negative case | Current state |
| --- | --- | --- | --- |
| 1. Populated canonical data inventory | A and B real separate owners; non-empty Coach, Training, Activity, Food/Hydration, Goals/EventHub, Community, Billing and every **actually installed** owner domain; exact inventory vs live catalog including join-only descendants; 25-row paging through one REPEATABLE READ READ ONLY snapshot | Unknown table/owner column, mixed snapshots, foreign row, lost page or source revision blocks | Partial isolated tests; comprehensive hosted release **not accepted** |
| 2. Auth/session/request binding | Real GoTrue A and B sessions, exact request UUID and owner; revoked/expired/foreign request fails before stage and on every download page | Stale bearer, wrong request/owner, concurrent revoke, request cancellation, clock expiry | Partial Auth staging/synthetic tests; full export endpoint **not accepted** |
| 3. Private media bytes and encrypted archive | Exhaustive private bucket catalog, each approved canonical file reference, owner path and SHA-256; authenticated trusted-server API byte download; stage chunks into **same** immutable encrypted archive; independent decrypt and byte-for-byte SHA-256 comparison | Orphan/foreign/missing object, unknown bucket, truncated file, wrong key, tamper, unauthorized signed URL blocks | Bounded local Storage tests exist; hosted full archive/KMS/device **not accepted** |
| 4. Durable cleanup and race freedom | Immutable owner+request+bucket path plan saved before first API delete, durable checkpoint per path and independent same-owner byte absence after delete, no orphan archive, all 3 request/Auth/metadata fences plus privileged writer lease | Upload-vs-delete race, missing persisted checkpoint, another owner's file, expired lease, metadata/byte disagreement fails closed | Simulated + hosted safeguard checks; operational worker **OFF** |
| 5. Full recovery | Restore separately approved populated database, Auth identities/session behavior and private binary bytes with checksums in isolated target; no unrelated secrets or user content; measured RPO/RTO | Missing media, missing owner table, failed sign-in, cross-owner read, stale post-delete access fails | ALL-12 remains an independent gate; production-style recovery decision **not accepted** |
| 6. Privacy, retention and legal | Written decisions on lawful export scope and redaction, outgoing/incoming relationships, third-party block privacy, joint CAS state, audit/legal-hold/erasure exceptions, archive TTL/KMS key retention, backups and provider copies; versioned owner consent | No arbitrary retention period; unresolved third-party visibility or legally retained receipts means no final complete claim | **Human legal/privacy review + founder approval missing** |
| 7. Device and operational release | Signed-in iOS/Android owner download, interruption/retry, share/save, expiry, secure file cleanup and deletion/cancellation receipt with incident recovery | Other device/account, revoked bearer, locked/expired archive or interrupted transfer rejected | **Not accepted** |

## Required human privacy/retention decisions (review with ALL-219)

1. Whether outgoing follows, recipient-visible requests, user-initiated blocks and own redacted action receipts are the correct portable Community scope. Do not disclose incoming blocks or shared pair-CAS hashes unless a documented contrary privacy/legal decision exists.
2. Which minimal deletion receipt fields may persist after erasure (if any), for what approved purpose/period and subject to which access restriction and legal-hold exceptions. The current private durable audit may contain user IDs until completion; approval must specify how to dispose of failures and avoid indefinite identifiable retention.
3. Export archive retention: exact TTL, cancellation/revocation purge policy, encrypted page/media retention, backup lifecycle and wrapped KMS key destruction/rotation handling. Current code enforces short-lived private delivery in places; **do not guess a legal period**.
4. Which service providers (Supabase, Storage and any approved KMS provider) process protected media and how verified deletion/backup retention and user notices work, using the actual V1-based legal documents rather than new boilerplate.
5. Whether owner-visible historical Coach content and Food/health considerations need a specific redaction/retention basis, and how cross-account Community records are treated during unilateral deletion.

Record reviewer, exact V1/V2 document version and effective date, owner approval, unresolved risks, and acceptance evidence links in ALL-219/251. No chatbot or CI test can provide independent counsel/legal approval.

## Current staging constraints

Temporary staging: `fbtgknlxjyeqrxemskbl` (scheduled for deletion). Preserve concurrently installed ALL-251 privileged Storage leases and all three live request/Auth/metadata fences. Existing new canonical profile/owner status and hard-OFF audit slices were installed; the entire Training/Completed and canonical export reader were **not**. Do not replay divergent foundation histories, reset shared staging, use production `xarhuczrtzuiljmtdaeu`, or incur new paid KMS resources without a separate approval.

## Evidence this review branch adds

[Draft PR #16](https://github.com/allinproject/All-In-V2/pull/16) extends the **same** canonical export/deletion scanners to require explicit treatment of join-only children and privileged Storage lease security. Its no-deploy CI runs exact-source PostgreSQL negative fixtures, alongside existing Node acceptance for authenticated source reads, encrypted archive/media, deletion Storage barriers and ALL-12 recovery-manifest checks. Passing those tests supports only the stated isolated scope, not a published complete archive or privacy approval.

**Release invariant:** keep `complete=false`, `completeUserExport=false`, deletion `execution_enabled=false`, and all unapproved client RPC/Storage permissions closed until every required gate is documented as independently accepted.


## 2026-11-13 integrated disposable Storage byte and durable database evidence

[GitHub Actions #43439850239](https://github.com/allinproject/All-In-V2/actions/runs/43439850239) **PASS** at commit `10be4453eddafded52ceba848dcb657976892369`: new `scripts/test-all251-storage-durable-checkpoint-real-api-local.mjs` starts real local Supabase Storage/Auth/Postgres services, creates an empty disposable private bucket, uploads synthetic files for two owners, and saves an immutable owner/request-scoped object plan **in the existing ALL-251 review database tables before the first API delete**. It then deletes A's two files using the authenticated server-side Storage REST API, proves each object's bytes are inaccessible, reads back the durable checkpoint records through the service-only PostgREST verifier, refuses missing checkpoint records, restores the checkpoint without repeating Storage deletes, refuses wrong-owner RPC verification, verifies B's bytes were unchanged by SHA-256 and checks idempotent cleanup. The fixture removes only its synthetic bucket, objects, review tables/functions and audit request; the pipeline stopped local Supabase with no backup.

The combined CI workflow also now runs the existing `test-all12-private-storage-two-auth-local.mjs` (real independent GoTrue accounts/sessions, private binary owner separation and restoration) and `test-v2-account-export-real-local-storage.mjs` (encrypted archive page and media bytes, binary restore/integrity and anonymous denial) in the **same disposable local Supabase test environment**. **These additional combined steps require a separate passing run before recording acceptance.**

**Critical release distinction:** the durable test uses `assertOwnerWritesQuiesced:async()=>true` only as an explicit **test fixture**. No real owner-write freeze attestation, hosted Storage deletion checkpoint or actual KMS exists from this proof. It is neither a deployment of the unfinished `v2_verify_account_deletion_storage_readiness` authority nor permission to arm `v2-account-deletion-worker`. The canonical export inventory is still `complete=false`; ALL-12 recovery and ALL-219 privacy/retention approval remain open.
