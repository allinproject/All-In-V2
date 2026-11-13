# ALL-251 — Four operational release gates: evidence and operator acceptance

**2026-11-13 status: NONE approved for release.** This is an extension of the existing ALL-251 / ALL-12 / ALL-219 acceptance ledger, not a new authority or a new legal policy. All gates remain independent; a test in one category cannot substitute for a missing gate in another. Preserve the shared hosted staging data and every newer ALL-251 Storage fence. Do not activate the canonical `complete=false` exporter, modify the hard-OFF deletion processor, enable the account-export Edge shell or merge draft PR #16.

## 1. Hosted KMS, existing AWS key only

The existing `trainingExportAwsKms.mjs` implements the KMS data-key/context contract and has **passing isolated SDK-shaped fake** tests. The new `scripts/test-all251-hosted-kms-existing-key.mjs` is an OPTIONAL operator-controlled real-provider acceptance client, NOT part of CI and **not executed**. It never creates KMS keys, roles or resources. Requires a preexisting customer-managed symmetric key, real least-privileged assumed role credentials (exact-key `kms:GenerateDataKey`, `kms:Decrypt`, and `kms:DescribeKey`; `sts:GetCallerIdentity` for identity verification), independently approved AWS cost, local ephemeral AWS SDK v3 `@aws-sdk/client-kms` and `@aws-sdk/client-sts` dependencies, and exact protected inputs:

- `ALL251_KMS_HOSTED_ALLOW=true`
- `ALL251_KMS_COST_APPROVED=true` (separate explicit founder approval for the existing resource/API charges)
- `ALL251_KMS_SYNTHETIC_ONLY=true`
- `ALL251_KMS_KEY_ARN`, `ALL251_KMS_REGION`, `ALL251_KMS_EXPECTED_ACCOUNT` from the preapproved protected operator environment; **never** commit actual values.

The script validates caller STS account/assumed role, exact enabled symmetric key, `GenerateDataKey(AES_256)`, owner/request-context-bound `Decrypt`, denial under a different synthetic owner and request, and wipes plaintext key material. It suppresses AWS exception content in ordinary logs. **This is only the KMS provider acceptance check:** a separate approved end-to-end hosted encrypted archive, repeated Auth lease and device-download exercise remains required. Obtain IAM review of policies, ciphertext/CloudTrail scope, approved region, operator, key ARN fingerprint, role identification, AWS request IDs in a **protected** evidence store and approved key/record retention before marking KMS complete. No real credentials, KMS IDs, ARN, test identities or ciphertext in Linear/GitHub comments.

If no approved KMS key, AWS role, or cost authorization exists: **do not run or provision anything**; record this gate BLOCKED. Existing non-hosted Node CI checks prove absence of the explicit cost/operator flags fails *before* loading AWS dependencies.

## 2. Authoritative upload freeze and deletion readiness

Existing `allin_private.v2_privileged_storage_write_leases_review` records privileged writes; three critical live guards are request-deletion, Auth-user deletion and Storage-object metadata insert/update fences. The existing `public.v2_verify_account_deletion_storage_readiness` **correctly returns** `completePrivateStorage=false` and `uploadBarrierEnforced=false` regardless of completed PostgreSQL checkpoints. Do not change those booleans to true based on flags, a test stub, client JWT, Storage metadata alone or a worker's self-reported receipt.

Required operational evidence from the **same approved owner+deletion request**: (a) complete enumeration of *all* authenticated and privileged writers, including direct Storage REST, signed upload and S3/tus; (b) a durable barrier acquired BEFORE cleanup that rejects subsequent writes for this owner/request; (c) drained in-flight leases and independent verification that new lease/open upload is rejected; (d) immutable per-bucket/per-path plan stored before the first delete, actual Storage API byte deletion and independent API-byte-absence readback; (e) durable per-path checkpoint and service-only aggregate RPC proving **every** current private bucket, no orphan/path from owner, no missing bytes or writer; (f) adversarial concurrent upload/delete/restore replay without destroying real user data, including a direct privileged client bypass probe; (g) separate Auth deletion and post-deletion API-byte/sessions/relationship recovery, with evidence of no counterparty data loss.

Accept only when a reviewer traces every writer path in current deployed code, service credentials and Storage API configuration; the **real** authoritative readiness implementation publishes independently verified evidence. Existing localhost tests and one temporary staging metadata guard are not this proof. The account deletion worker must remain OFF pending ALL-12 recovery acceptance.

## 3. Privacy, retention and legal approval (ALL-219)

The existing **V1 Founder Beta Legal Package (Working Draft)** is the legal source. The Community export/privacy review already proposes user-initiated follows/blocks/requests, redaction of incoming blocks and raw pair-CAS. None is final legal wording. Record in ALL-219 the exact legal document name, version and checksum, date, provider/privacy counsel reviewer, founder decision and remaining redlines for:

1. **Portable scope:** Coach records, Nutrition/health details, Billing, device data, all real private media, Community bilateral records, incident/moderation data and third-party private state.
2. **Deletion exceptions:** minimal durable audit/receipts, consent evidence, chargeback and legally mandated retention, failed deletion claims, legal holds, and precise deletion vs anonymization behavior.
3. **Durations:** archive TTL and purge after cancellation, device cache, inactive relationship/pair CAS, KMS-wrapped keys, provider logs/backups/PITR snapshots, deleted-user recovery evidence, with operator responsibility and user notices.
4. **Lawful processors:** actual Supabase, AWS KMS, AI providers and cross-border processing, using real deployed configuration, business identity and final legal disclosures.

**No lawyer-reviewed or founder-approved final text was received in this workstream.** Do not record signoff or claim the export/deletion policy was legally approved. Reopen ALL-251 only when the authoritative approvals and tested runtime match.

## 4. iOS and Android installed-device acceptance

The current Profile route uses an INCOMPLETE JSON snapshot; the full streamed encrypted export downloader is *not* shipped. The native helper `accountExportLargeFile.ts` is an injected pre-release contract, not proof of device delivery. In draft PR #16 it additionally checks the current signed-in owner **after** native preview returns and purges the temporary plaintext file if the account changed during preview. This does not change the shipped screen or native viewer. Existing native preview may resolve **before** the external viewer closes; do not delete cache immediately on normal successful preview. Screen/shell lifecycle MUST remove plaintext cache on final viewer dismissal, owner/session switch, background/restart and logout and must signal manual-attention failures.

Acceptance must be performed on **installed, signed builds** of both iOS and Android against an explicitly approved non-production endpoint and real A/B GoTrue sessions, and preserve device/build/OS versions, UTC time, tester, evidence and defect numbers, without attaching a user's plaintext archive. Required test matrix:

| Scenario | iOS | Android | Expected |
| --- | --- | --- | --- |
| Owner A valid authorized export, streaming >5 MB | Pending | Pending | Verified NDJSON terminal receipt and no premature share |
| Private FIT/route media restore and SHA-256 | Pending | Pending | Byte-for-byte original data match |
| B token accessing A request | Pending | Pending | 401/403; never download A bytes |
| Revoked/expired session and cancelled request | Pending | Pending | No new archive or download |
| Network interruption then retry | Pending | Pending | Partial cache deleted, no false verified delivery |
| Owner switch during native preview | Unit tested; device pending | Unit tested; device pending | Reject and purge cache |
| Viewer dismissal, background, logout, app restart | Pending | Pending | No exposed lingering cache; clear handling of OS share copies |
| Corrupt/missing encrypted page, changed object checksum | Pending | Pending | No completion receipt/preview |
| Retention expiry and stale download URL | Pending | Pending | Denied without public Storage URL |
| Deletion request/cancel and restore receipt | Pending | Pending | Only approved states, no destructive action without final gates |

All `Pending` results are real blockers, not simulated passes. Store private videos/screenshots outside public issue bodies; record non-sensitive evidence references. Owner, reviewer and both mobile build IDs required for final acceptance.

## Current safe automation and next execution

- The low-cost, no-network [release gate safety CI workflow](../../.github/workflows/v2-all251-release-gates-safety.yml) tests that unapproved KMS runs fail and checks native cache/owner-switch unit contracts.
- Separately, current combined local SQL+media archive test passes **51 sources / 108 records / 24 encrypted pages**, but its key grant and media byte source are test adapters. Neither is permission for hosted KMS or a published account archive.
- Next independent work: choose an already approved isolated KMS role/key or obtain explicit cost approval first, finish the actual operational Storage write-freeze authority and provider-side backup/restore, obtain human legal redline approval, and run installed-device acceptance.
