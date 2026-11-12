# ALL-12 — V2 independent recovery acceptance (review-only)

Status: **not accepted**. This runbook does not waive the provider physical-backup gate or authorize hosted operations.

## Boundaries

- Source of truth: V2 project `xarhuczrtzuiljmtdaeu`, not V1 `impulecgsgaruvniuttc`.
- Existing `All-In-V2-Temporary-Staging` (`fbtgknlxjyeqrxemskbl`) is **not** an approved recovery target merely because it exists. It may hold unrelated concurrent test data. Never reset, overwrite or reuse without a fresh inventory, owner consent and explicit scope.
- No production or staging writes, hosted dumps, paid resources, physical restore, outbound-job changes, or secret exports are authorized by this document.
- Existing local foundation replay and synthetic billing `pg_dump/pg_restore` prove **partial** logical recovery only; neither is a complete V2 restore.

## Required preflight before any real backup

1. Capture authoritative V2 branch SHA, target project ref, Postgres version, applied migration ledger, installed extensions, schema objects, RLS and grants; compare with the immutable foundation manifest.
2. Inventory every owned V2 domain and its durable source of truth (Auth users/identities and session behavior, profile/legal, Training/Completed Activity and device sources, Coach, nutrition/pantry/recipes, progress/recovery/gear, Community/RaceHub, billing, privacy exports/deletion). Mark absent or unapproved candidate tables **absent**, not covered.
3. Inventory Storage buckets/objects and associated ownership metadata separately; include application configuration, Edge Functions, Auth settings, secrets, webhook configuration and third-party provider state as distinct non-database recovery dependencies.
4. Confirm data classification, encryption at rest/in transit, access to dump artifacts, short retention, and destruction receipt. Never put user data, JWTs, API keys, Vault secrets, or backup artifacts in CI logs or Git.
5. Obtain approval for an **isolated disposable** destination with zero live integrations. Verify network egress and scheduled workers cannot fire **before** importing any source material. Do not import active `pg_cron` jobs, `pg_net` requests, webhooks, foreign servers/user mappings or Vault credentials. Reject unsafe dump content before import rather than attempting to disable it afterward.
6. Establish an exact source snapshot cutoff, recovery-point objective (RPO), recovery-time objective (RTO), and permitted loss budget. Record clock source and timestamps.

## Execution contract (only after preflight and approval)

1. Produce a consistent logical backup of authorized source schema/data using a least-privileged backup identity; capture tool version, start/end, snapshot cutoff, encrypted artifact digest, and domain manifest. Handle Auth carefully: database rows alone do not restore provider Auth configuration, signing keys or external identity credentials.
2. Independently capture private Storage bytes plus object manifest, checksum, owner and privacy classification. Database `storage.objects` metadata is not proof the object bytes were recovered.
3. Inspect/sanitize the dump in a controlled pipeline **before** loading into an outbound-disabled target. Prefer an allowlisted restore manifest over stripping arbitrary SQL with regex. Never assume disabling jobs after startup is safe.
4. Restore schema, roles/grants and data in dependency order. Preserve migration ledger and immutable identity keys. Restore private media with matching owner checks. Restore or reconfigure necessary Auth/app settings without reusing live secrets or sending messages.
5. Compare source-at-cutoff vs target: migration versions, schema fingerprints, row counts and deterministic digests for each present domain, foreign keys, source provenance, billing event idempotency, Storage object hashes, deletion/tombstone state, and encryption/decryption behavior. Document each exception.
6. Exercise two separate authenticated test accounts against recovered API: own reads succeed; cross-owner reads/writes fail; anon denied; expired/revoked tokens denied; device ownership cannot be self-certified; private media download requires correct owner. Use synthetic identities where possible.
7. Demonstrate an authenticated owner can read previously persisted workouts, Coach history, settings, and account metadata after restore; verify pending ingestion idempotency and safe retries. Do not claim phone-installed upgrade coverage.
8. Record observed RPO/RTO, failure/retry behavior, test artifacts and reviewers. Securely delete all recovery artifacts and disposable resources after approval and retention window; log deletion evidence.

## Stop / failure conditions

- Unknown snapshot provenance or missing domain/media coverage.
- Uncontrolled outbound effects, active production credentials, or incomplete egress isolation.
- Missing restored owner rows, mismatched digests, broken RLS, unauthorized access, or inability to reauthenticate.
- Unreviewed migration drift or unresolved ALL-12 provider physical-restore evidence.
- Any additional billable resource or production change without explicit approval.

## Existing evidence and honest status

- Prior V1 physical Restore-to-New-Project UI showed COMPLETED; snapshot mapping and post-restore integrity records were not retained. Supabase ticket `SU-542002` confirms no guaranteed pre-start isolation of copied `pg_cron`/`pg_net`.
- Existing V2 local CI replays foundation/candidate SQL and uses a **synthetic billing-only** `pg_dump/pg_restore` with owner and receipt assertions.
- Neither result validates a complete V2 logical backup, private Storage recovery, production Auth settings, or the provider's managed physical backup. Keep ALL-12 **In Progress** until evidence is collected and the release gate is explicitly reviewed; do not silently substitute one recovery class for another.
