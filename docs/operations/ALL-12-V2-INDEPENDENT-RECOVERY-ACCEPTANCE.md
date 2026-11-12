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

## 2026-11-12 — Release acceptance review (not a waiver)

Authoritative read-only V2 hosted table inventory: 12 application tables (5 public, 7 allin_private), no Auth users and no Storage objects. The recovery manifest now explicitly registers all 12 current foundation application tables. This is **inventory classification**, not backup/restore validation of their contents.

### Evidence accepted for engineering development only

- Disposable local Supabase foundation migration replay and candidate-table logical `pg_dump/pg_restore`, including two-owner Training/Completed Activity/source/Coach/Goals row-count and deterministic full-row comparisons.
- Synthetic Auth identity-row restoration followed by real local password sign-in, token refresh and logout checks.
- Synthetic private Storage object-byte deletion/recovery with SHA-256 checks and valid cross-account access denial.
- Fail-closed recovery manifest checks, including a test against the known hosted V2 foundation table names.

### Unmet release gates

1. **Complete logical domain restore:** Seed and restore representative data for the deployed foundation profile/settings/onboarding/legal/health/deletion/private-action tables and every newly approved domain, including sensitive fields, immutable receipts, and action ledgers. Reconcile actual schema inventory automatically; a static known-table unit test alone cannot prove future completeness.
2. **Auth configuration and operational restoration:** Prove fresh credential sign-in after restoring the required Auth users/identities and password verifier in an isolated destination; validate Auth service configuration, external identity providers if enabled, key rotation, recovery/expiry, and session semantics. Current identity-row roundtrip retains the original user/password record.
3. **Private Storage completeness:** Prove every authorized object and its metadata can be recovered, not just two synthetic objects; reconcile ownership, hashes and absent/deleted objects.
4. **Hosted recovery:** Obtain independent hosted recovery evidence (approved safe target, verified outbound isolation, snapshot provenance, restored data/permissions and measured RPO/RTO) or an explicit founder-approved alternative risk decision documented separately. Local logical recovery is not provider-managed physical recovery.
5. **Release approval:** Review security/privacy/legal implications and authorize a clearly scoped release gate. No implicit production deployment, signup opening, or billing authorization.

Founder-beta development and isolated testing may continue while these gates are open. **Do not mark ALL-12 Done, production recovery accepted, or hosted deployment approved based on local tests.**

## 2026-11-12 — Dynamic catalog inventory gate and release decision

The existing clean local Supabase replay now executes `scripts/test-all12-live-schema-inventory-local.mjs` against the actual disposable PostgreSQL catalog, rather than passing a hardcoded table list to the manifest. Any new `public.v2_*` or `allin_private.v2_*` base table missing from the recovery manifest fails the step. This checks *classification*, not complete restoration. Review its CI outcome before accepting the guard.

The 12/12 foundation restore green evidence is GitHub Actions run 43290696689 (local synthetic only). It does not include full Auth credential verifier/key/config recovery, external providers, all future candidate schemas, or a hosted provider physical restore.

**Release acceptance remains blocked.** No safe approved physical recovery destination or provider snapshot provenance is established. Existing temporary staging is not available for destructive reuse without separate approval. A founder risk acceptance may define a narrower beta release policy, but cannot truthfully convert local recovery into provider physical-restore evidence. Keep ALL-12 In Progress and avoid enabling destructive production operations or opening signup on the strength of this test alone.


## 2026-11-12 — Populated Auth and Training acceptance evidence

Verified [disposable local replay run 43306483796](https://github.com/allinproject/All-In-V2/actions/runs/43306483796) completed SUCCESS, explicitly including a populated, two-owner GoTrue Auth database logical backup, deletion, row restoration and real password sign-in/owner binding; 12-table populated foundation backup/delete/restore; existing selected multi-domain restore; and five connected Training plan tables for two synthetic owners. The `auth.refresh_tokens.user_id` varchar-vs-UUID test predicate was corrected before this successful run. These tests establish **local synthetic engineering recovery evidence only**, not hosted Auth configuration, signing key/IdP recreation or provider-managed physical snapshot restoration.

Additional *candidate-schema* populated restore tests were added for EventHub (six tables), Community private relationships (five tables), and indoor weekly Progress (five tables), each using synthetic rows and deterministic full-row comparisons. Their first executions **are not accepted without green CI**. The initial EventHub test failed on a shell fixture bug, then exposed its intentional canonical event deletion trigger. The revised disposable loss simulator temporarily disables only that trigger inside a PostgreSQL transaction, reenables it before commit, and checks restoration of the protection; see [commit 8ee5ac3c](https://github.com/allinproject/All-In-V2/commit/8ee5ac3c46369d8b7ab61db2ec34c882a27a038e). [Combined replay 43308846304](https://github.com/allinproject/All-In-V2/actions/runs/43308846304) requires independent outcome verification.

Keep unknown or schema-pending domains (including Nutrition), full Auth/config and complete Storage coverage, current live catalog versus accepted restore coverage, and provider physical disaster recovery **open**. Do not equate success of individual local candidate data tests with full deployed V2 restoration, RPO/RTO measurement, signing secret recovery or founder release approval.
