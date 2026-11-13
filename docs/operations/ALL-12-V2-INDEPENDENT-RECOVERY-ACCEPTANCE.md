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


## 2026-11-12 — EventHub, Community and indoor Progress populated restores GREEN

Verified the **specific recovery test steps** succeeded in [GitHub Actions run 43309615671](https://github.com/allinproject/All-In-V2/actions/runs/43309615671) at integration SHA `82101dd883c4d2fccb8c77d1b8f36741d08b903f`:

- `ALL-12 populated EventHub six-table restore`: six connected candidate tables; two synthetic owners, full-row digests, graph bindings and explicit participation state. The disposable loss simulation transactionally re-enables the canonical event deletion trigger before restore.
- `ALL-12 populated private Community graph restore`: five private candidate tables; visibility, pair revisions, follows, blocks, action receipts, and owner relationship preservation.
- `ALL-12 populated indoor Progress restore`: five candidate tables; synthetic challenge, verified scoring fixtures, leaderboard, achievements, and verified generation/publication/finalization configuration remains disabled.

The same run's Auth, foundation, selected multi-domain, Training, private Storage, and logical catalog checks also reached passing conclusions. These step results are **local synthetic logical restoration evidence only**. Do not infer full user-domain completeness or hosted physical restore from 58/58 table *TOC inclusion*: present schema registration and populated domain restoration have different acceptance gates.

Remaining acceptance: reconcile actual approved Nutrition schema and any new domain tables, full current private Storage object-byte inventory and retention, Auth signing keys/config/external provider recovery, provider physical snapshot provenance/egress-safe independent restore and measured RPO/RTO, and explicit founder release review. ALL-12 remains In Progress; no hosted changes authorized.


## 2026-11-12 — Read-only live V2 baseline and physical recovery evidence gate

**Read-only live inventory**, source project `xarhuczrtzuiljmtdaeu` (V2) as checked 2026-11-12, not V1: 12 present application `public.v2_*` / `allin_private.v2_*` tables, all 12 RLS enabled; 18 applied migrations; 0 Auth users / 0 Auth identities; 0 Storage buckets (therefore 0 objects); 0 deployed Edge Functions. The installed DB reports Postgres 17.11.0.018 and one enabled cron job `allin-v2-provider-cache-expired-purge` at `17 * * * *`. A lightweight command regex did not match direct `net.http_*` / Vault / FDW identifiers; **this is not proof of zero outbound side effects**, because calls through helper functions/triggers and provider services have not been traced.

The foundation 12-table logical recovery test passed synthetically, but **no real hosted source backup, independent target restore or source-cutoff reconciliation was executed**. Zero present accounts and buckets make current V2 data scope smaller, not proof that Auth settings, key rotation, Storage rules, migration upgrades or future media recovery are complete. Deployed tables are not the same as the 58 candidate V2 tables in local schema CI; do not report candidate restore coverage as deployed live recovery.

The existing `scripts/all12-recovery-domain-manifest.mjs` now exposes `assessIndependentRecoveryEvidence` with negative/positive tests in the established manifest test suite. It separately demands real provider snapshot and cutoff, distinct restored target, measured elapsed/RPO/RTO values, pre-start outbound isolation and scheduled-worker quarantine, snapshot-aligned schema/RLS/data and owner authorization comparisons, Auth configuration and Storage file-byte/metadata recovery, current domain inventory reconciliation, and explicit reviewed release authorization. **These inputs are evidence-review claims, not a substitute for independent verification**; the gate must not be passed by simply supplying placeholder booleans. In particular, a successful local `pg_dump/pg_restore` or provider dashboard label `COMPLETED` is insufficient.

**Next safe steps:** retain V2 production as read-only; independently design and approve a source-consistent isolated restore destination before attempting anything destructive; record snapshot provenance and the exact side-effect isolation design before any hosted clone; assess current Auth/Storage non-database configuration recovery and decide which external services must be manually reconfigured. A repeat provider clone or reuse/reset of temporary staging requires explicit separate approval and pre-start safety review. The hosted physical recovery gate stays open.


## 2026-11-12 — Read-only hosted source fingerprint prepared, not a restore

The repeatable source/target comparison query is now checked in at `supabase/tests/all12_hosted_restore_readonly_fingerprint.sql` (commit `c18ee859970388be38396959d5c4a94ceba61b02`). Its **exact committed contents** were executed successfully against live V2 source project `xarhuczrtzuiljmtdaeu` without writing rows or reading backup secrets. It returns per-table column-definition, RLS-policy and constraint definition hashes, one aggregate application schema fingerprint, migration ledger fingerprint, Auth and Storage counts, and active-cron count. It does not read athlete content or include cron commands, provider keys or encrypted Storage bytes.

The point-in-time **observation** (NOT a backup snapshot) is:
- Postgres 17.11; 12 V2 application tables, all RLS enabled.
- 18 migrations; migration ledger MD5 `ca918322e6085262f98ffe58c1b799aa`.
- Application schema MD5 `b65dea5bde985ef88892903ee4764c60`.
- Auth users 0, identities 0; Storage buckets 0, objects 0; active cron jobs 1.
- Cron job `allin-v2-provider-cache-expired-purge` has a direct command-text scan with no identified HTTP/Vault pattern, **not** verified pre-start outbound safety.

**Operational use:** on a separately approved, safely isolated and independently restored physical backup target, run the *same unchanged* query, compare the whole source-at-snapshot manifest with the restored snapshot, then separately validate actual table data, ownership/RLS, Auth configuration and fresh sign-in, Storage object bytes and metadata, and application runtime. Comparing this *current* live fingerprint with a backup from a different migration/snapshot cutoff can legitimately mismatch; source cutoff must be established first. Checksums here are metadata MD5 fingerprints, **not cryptographic artifact integrity attestations or row-content recovery checks**.

The original V1 project `impulecgsgaruvniuttc` has historical `pg_cron` / `pg_net` outbound workers and the linked Supabase support ticket `SU-542002` still has **no approved pre-start isolation method**. Last inspected email was founder follow-up Nov 12; no later provider evidence. Do not clone V1 or treat its prior deleted targets as validated. Do not reset current V2 temporary staging or create a billable provider clone without separately verified isolation, destination approval, cost review and a source recovery point.

ALL-12 remains **In Progress**. This preflight advances independent restoration readiness, but no provider physical backup was restored or verified.


## 2026-11-12 — Independent logical acceptance is a first-class alternative

The founder-selected ALL-12 implementation is **independent logical pg_dump/pg_restore**, **not** Supabase Restore-to-New-Project. Do not resume physical clone preparations or provision/reuse a paid recovery project. [GitHub Actions run 43319878768](https://github.com/allinproject/All-In-V2/actions/runs/43319878768) is verified green on the disposable local recovery suite (Auth, foundation, Training, Coach, EventHub, Community, Progress, Storage authorization and full-row digests). These tests are accepted as **local engineering evidence**, and need not be repeated to revisit the decision.

The existing recovery-domain manifest now has a separate `assessIndependentLogicalRecoveryEvidence` acceptance function and regression tests. This path **does not require `providerPhysicalRestore`**. It requires source-cutoff provenance and artifact SHA-256, distinct safely isolated target, evidence of eliminating outbound execution paths *before importing*, consistent backup/restore timestamps and measured RPO/RTO, source-at-cutoff inventory reconciliation, restored Auth sign-in and project configuration, full present-domain data and RLS/owner denial, Storage bytes and metadata, secure artifact cleanup, and an explicit reviewed founder decision. Evidence booleans in a unit test are *examples*, not proof these operations were performed. It remains fail-closed until independent evidence is actually gathered and reviewed.

The provider-managed **physical** backup acceptance function is kept only to distinguish its evidence class, not as a required step of the logical workaround. A separately governed founder-beta risk decision may accept a constrained recovery posture; it must state any missing scopes openly, and must not be misreported as a complete hosted data recovery drill.

**Next operational gap:** demonstrate a source-consistent *actual* logical backup of authorized V2 data into an independently isolated restore target, record cutoff/digest and timing, and verify applicable Auth/Storage/config and owner-domain checks. This cannot be inferred from the synthetic CI suite or a read-only live schema fingerprint. Keep production changes, hosted exports and the shared temporary staging target out of scope until explicitly authorized.


## 2026-11-12 — Actual deployed data scope under logical recovery

Read-only V2 `xarhuczrtzuiljmtdaeu` SQL catalog check repeated: 12 deployed `v2_*` application tables, 18 applied migrations, **zero** Auth users/identities, **zero** Storage buckets/objects, and one enabled database cache-purge cron job. This is a *present-state observation*, not a proven snapshot of a later backup. Do not substitute synthetic candidate-schema coverage for deployed-source data.

The existing logical acceptance evaluator `scripts/all12-recovery-domain-manifest.mjs` now handles **source-at-cutoff verified zero versus populated** Auth/Storage requirements (commits `01c61dc8`, `349c0b50`):
- A genuine zero-Auth source must show a verified empty source inventory, an empty recovered Auth target, a functioning Auth service and recreated provider configuration. No invented synthetic users are counted as deployed recovery data.
- A populated Auth source must instead show restored actual account data and sign-in.
- A genuine zero-Storage source must show a verified empty object inventory, empty restored target and verified Storage access policy/configuration. A populated source requires actual restored file bytes/metadata.
- Both source counts are mandatory. Source-at-cutoff manifest provenance, actual logical archive integrity, independent pre-import isolation, restored owner-domain rows and RLS, RPO/RTO and explicit review remain mandatory regardless of emptiness.

**CI evidence:** [run 43326920981](https://github.com/allinproject/All-In-V2/actions/runs/43326920981) passed the ALL-12 independent recovery scope test step; the full clean replay must be checked separately before calling the workflow green. Previous [run 43319878768](https://github.com/allinproject/All-In-V2/actions/runs/43319878768) remains the accepted full local synthetic recovery suite. Neither represents a real authorized hosted logical source dump.

**Final operational boundary:** Obtain a source-consistent logical archive from an approved V2 source using an authorized read-only backup identity, an independently isolated target and explicit artifact security/recovery verification. This session's connected Supabase tools can inspect SQL catalog state but cannot export a real PostgreSQL dump or control the GitHub runner's secret-backed PostgreSQL connection. Do not use the temporary ALL-251 staging project as a substitute or mark ALL-12 done solely from an empty hosted inventory.


## 2026-11-12 — Pre-import logical archive inspection (data-only)

The founder-selected independent logical recovery path now has a **read-only** offline archive guard in `scripts/all12-verify-logical-archive.mjs` with regression tests and the existing clean replay CI job. It uses `pg_restore -l` (list only) on a real `pg_dump -Fc --data-only` file and computes the artifact SHA-256 from bytes; it **never** runs `pg_restore -d`, connects to the database, reads owner records or executes SQL.

For an eventual separately authorized drill, store the encrypted archive and approved manifest **outside Git, CI logs and shared storage**. The reviewed manifest is a local JSON file with `sourceProjectRef`, exact `backupCutoffUtc`, `archiveSha256` (64 hex chars), explicit `tables` of qualified names and optional `sequences`. The source-at-cutoff table list MUST be independently captured from the same consistent backup snapshot; do not copy a current production inventory with a different timestamp or manufacture the digest. A sample shape (placeholder values **not** acceptance evidence) is:

```json
{
  "sourceProjectRef": "approved-v2-source-ref",
  "backupCutoffUtc": "2026-11-12T20:00:00Z",
  "archiveSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "tables": ["auth.users", "public.v2_profiles"],
  "sequences": []
}
```

When the real archive, independent inventory and trusted SHA exist, an authorized operator can run **only the offline inspection**:

```bash
node scripts/all12-verify-logical-archive.mjs \
  --archive /secure/recovery/source-data.custom \
  --inventory /secure/recovery/approved-inventory.json
```

Inspection fails closed on a missing/extra/duplicate table or sequence, unapproved schemas, a mismatched archive digest, missing source identity/cutoff, and unsupported TOC entries including function definitions, extensions, jobs or non-allowlisted executable restore objects. A data-only TOC that matches exactly is **not** proof of per-row integrity, full domain coverage, artifact confidentiality, provider configuration recovery, absence of side effects in preexisting target functions/triggers, safe import, or measured RPO/RTO. The actual target must still be independently prepared with outbound capabilities disabled *before* any import.

This guard is a prerequisite only, **not** a substitute for the genuine source-consistent backup, actual isolated restore, Auth/Storage and ownership verification, cleanup, and explicit founder release acceptance. No hosted source dump, shared staging reset, physical Supabase restore or paid recovery resource has been authorized or run by this change.


## Operator-only logical capture: first real archive

The independent logical-recovery path has a guarded, **locally operated** source capture tool: `scripts/all12-capture-approved-logical-backup.mjs`. It uses PostgreSQL's normal `pg_dump -Fc --data-only` against exactly the approved source table list. It **does not** restore anything, execute SQL against the target, access the shared temporary staging project, or export the archive through GitHub Actions. This is an operator-only mechanism: the existing CI runs *guard tests*, not the capture.

**Prerequisites before running:** An authorized PostgreSQL backup role with SELECT access to the specifically approved V2 tables (ideally read-only and limited lifetime), locally installed `pg_dump` matching the server major version, an encrypted-at-rest operator-controlled backup directory, verified TLS connection settings/certificate chain, and a reviewed local inventory JSON. The table list must come from a reviewed live source inventory and remain a separately approved source of truth—not generated from the archive's own TOC. A source table lacking authorization must stop the capture rather than be silently skipped. Do not store database credentials, a backup archive, an inventory containing sensitive data, or private manifests in Git or any CI artifact.

Example approved inventory **shape only**, not an approved final table list (do not run this example against production):

```json
{
  "sourceProjectRef": "xarhuczrtzuiljmtdaeu",
  "approvedForLogicalBackup": true,
  "tables": ["auth.users", "public.v2_profiles"]
}
```

On the authorized operator's PC, set environment variables locally (do not paste values into chat, screenshots, repository settings, or CI logs): `PGHOST`, `PGUSER`, `PGDATABASE=postgres`, `PGPASSWORD`, `PGSSLMODE=verify-full` (and the required CA configuration, port and connection parameters). Then set `ALL12_CAPTURE_APPROVED=YES`, `ALL12_SOURCE_PROJECT_REF=xarhuczrtzuiljmtdaeu`, `ALL12_BACKUP_DIRECTORY` to an encrypted-at-rest private local directory, and `ALL12_SECURE_BACKUP_DIRECTORY_CONFIRMED=YES` only after actually verifying the destination's security. Run:

```powershell
node scripts/all12-capture-approved-logical-backup.mjs --inventory C:\secure\all12-approved-tables.json
```

The script refuses GitHub/CI execution, missing approval, other project refs, weaker TLS settings, a missing source identity or unapproved table list. It creates private-permission archive/metadata files in the designated location, emits only status and SHA-256, and deletes partial outputs on capture failure. The written capture metadata includes a **bounded snapshot-cutoff window** between the dump's start and completion, **not a fabricated exact snapshot timestamp or measured RPO**. Actual encryption at rest and authenticity of operator input cannot be independently established by this script.

**Next separate steps (not done by capture):** Independently attest the actual source-at-cutoff inventory and compatible sequence list, inspect the archive with `all12-verify-logical-archive.mjs`, provision an unrelated isolated database with outbound actions disabled before import, restore only onto that disposable target, compare source/target data and RLS, validate Auth configuration/sign-in and private Storage according to actual counts, record true RPO/RTO, securely clean up temporary artifacts, and explicitly accept or decline the scoped release. Do **not** enter acceptance flags by hand or claim `ALL-12 Done` from an archive checksum alone.

**Operational limitation:** The connected Supabase tools in ChatGPT cannot run `pg_dump` against the authorized V2 source or retrieve the resulting archive. This capture must be executed by an authorized operator in an isolated/local environment with credentials never disclosed to ChatGPT. No paid clone or provider physical restoration is required.


### Live deployed-table reconciliation before capture

The local operator capture now runs a **read-only `psql` catalog query** against the same project-scoped PostgreSQL connection *before* invoking `pg_dump`. The source's actual `public.v2_*` and `allin_private.v2_*` tables must all appear in the approved capture list, or the operation fails without producing an archive. `auth.users`, `auth.identities`, `auth.sessions` and `auth.refresh_tokens` are also mandatory, even when the source has no users. A newly deployed V2 table cannot be silently omitted by an older reviewed list.

The operator must reconcile the *entire* V2 table inventory, not just the sample `auth.users` and `public.v2_profiles` listed above. That example is intentionally incomplete and will be refused. This check is a point-in-time preflight; a migration between catalog inspection and the dump still requires independently comparing the archive cutoff with the source and migration state. Additional Auth provider configuration and Storage metadata/object bytes require separately reviewed recovery plans; the core Auth table list is a minimum, not the whole service-state contract.

The backup archive is never handled by ChatGPT or GitHub Actions. It must remain in an independently secured, encrypted operator-controlled location; the workflow only tests that stale/incomplete inventory is rejected.


### Capture window catalog-drift guard

The operator capture performs the same read-only V2 schema inventory query both **before and after** `pg_dump`. If the deployed V2 table set changes or either catalog readback is malformed, it deletes the untrusted archive and metadata rather than accepting them. The dump connection itself sets `default_transaction_read_only=on`; capture never applies migrations or writes to production. The local report records the deployed table count and the matched pre/post check.

**Limit:** Matching pre/post table names does not establish a single PostgreSQL snapshot across catalog queries and dump, prove row-content consistency, or recover Auth/Storage configuration and object bytes. A migration can theoretically occur and reverse between checks, and row mutations are not detected by table names. Independently attested source cutoff, archive TOC, data integrity, isolated restore and explicit release review remain required.


## 2026-11-13 — Reconciled independent V2 logical-recovery evidence (release gate remains blocked)

This is an **evidence reconciliation, not a declaration that the drill is accepted**.
The source project is `xarhuczrtzuiljmtdaeu`; the shared temporary staging
project is not a recovery destination. Do not upload backup bytes or secrets to
the repository, Linear, CI artifacts, or chat.

| Requirement | Evidence obtained | Acceptance state |
| --- | --- | --- |
| Real deployed-source backup | Authorized PC operator reported a scoped data-only V2 `pg_dump -Fc` archive captured 2026-11-13T01:36:50.541Z–01:37:01.122Z, SHA-256 `31f7f9ebf3ed2313ea367c99e6951592ad76fc65692db730e8e44b08f3d2beea` | **Partial/operator-reported**: backup interval is not an independently established exact snapshot cutoff |
| Artifact provenance and scope | Operator-reported verified SHA match in encrypted local VeraCrypt volume and isolated container; exactly 16 approved table-data entries (12 deployed V2 application tables, 4 Auth) and `auth.refresh_tokens_id_seq`, no large objects | **Partial**: pre/post inventory names compared, source-cutoff sequence and independently captured per-row digests remain unverified |
| Isolated database restore | Operator reported separate PostgreSQL 17 Docker restore in `network=none` `all12-scoped-restore-20261112`, with restored 16 table-data entries, 32 FK constraints, one disabled processor singleton; other 15 table counts zero | **Partial**: offline DB restore is observed through operator console evidence; no independently verified outbound capabilities of *all* restored/configured services, full schema/config parity or snapshot-aligned digest attestation |
| ACL/RLS and synthetic identities | Operator reported eight source-derived ACL GRANTs (including column-scoped profile UPDATE), two-owner profile RLS and synthetic Auth relationship / revoked-session restoration. [Full CI foundation run 43360754808](https://github.com/allinproject/All-In-V2/actions/runs/43360754808) independently confirms all 13 local synthetic ALL-12 steps passed | **Engineering evidence accepted**, NOT authentication/configuration recovery from the real V2 source backup |
| Live source status after capture | Read-only Supabase observation 2026-11-13T03:48:50Z: 12 V2 application tables, 12 with RLS, 18 migrations, zero Auth users/identities, zero Storage buckets/objects | **Observed**, but not the source-at-backup cutoff or proof that later source state equals backup state |
| Private Storage | The actual source reportedly had zero buckets/objects; synthetic local Storage byte restore + owner denial passed CI | **Pending operational acceptance**: source-at-cutoff empty-inventory evidence, target-empty evidence and recovered Storage policy/config are separately required; synthetic objects cannot be presented as hosted-source objects |
| Auth/app configuration | Database Auth rows were empty in the captured source; local synthetic real GoTrue sessions and credentials passed CI | **Pending**: independently reconstructed target Auth provider settings, JWT key strategy, integrations, service boot and session acceptance |
| Operational timing | Capture **window** known; independently measured time-to-restore and cutoff-based recovery-point difference not established | **Unverified**: do not fabricate RPO/RTO from timestamps that measure different phases |
| Off-host recovery and retention | Archive retained encrypted on operator-controlled V:; isolated PostgreSQL tests and source-derived ACL checks reported | **Pending**: artifact retention/cleanup evidence, durable off-host backup availability and target egress isolation review |
| Formal review | Founder chose an independently verified logical recovery path rather than requiring a new physical clone. No acceptance of incomplete operational evidence or production release was given | **Not accepted** |

### Exact remaining independent logical-acceptance evidence

1. Inspect the encrypted operator-held archive and capture manifest locally; establish the authentic source snapshot cutoff, archive/manifest signature and complete source-at-cutoff V2/Auth/sequence table inventory. Verify source and restored row-content digests, ACL/policy/role parity, triggers and migration ledger at the same snapshot—not at today's source state.
2. Demonstrate that the independently isolated target was outbound-disabled *before* importing source data and cannot run copied cron, webhooks, Vault, net/HTTP, third-party integrations or production credentials. Archive `network=none` for the container supports only that container's network isolation, not restored service configuration.
3. Prove recovered Auth configuration and service startup and the verified empty-hosted-source account/Storage fallback if source cutoff truly had zero users and files. Real recovered source account credentials cannot be tested when none existed; test synthetic accounts separately and label that evidence as synthetic.
4. Capture independently measured backup/recovery timestamps, RPO and RTO using a stated clock and restore-complete service verification. Confirm encrypted artifact retention/cleanup and independent evidence reviewer.
5. Re-run `assessIndependentLogicalRecoveryEvidence` only with independently verified, traceable evidence. Obtain explicit scoped founder release decision; keep provider-managed physical restoration separate.

**Decision:** `independentLogicalRecoveryAccepted=false`,
`providerPhysicalRestoreAccepted=false`, `releaseReady=false`.
The successfully green local synthetic recovery suite is retained and must **not**
be repeated solely to satisfy missing real-source operational evidence.
No new billable project, remote restore, production data mutation, or deployment
is authorized by this section.
