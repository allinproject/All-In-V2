# ALL-230 / ALL-12 — read-only legacy restriction source observation

**Observation only; not an approved full-history or import manifest.**
No source data, account identifiers, tokens, individual row hashes, or backup files are included here.

## Authoritative project observations

- V1 source project: `impulecgsgaruvniuttc` (All in).
- Single read-only PostgreSQL statement observed at **2026-11-13 13:00:35 UTC**.
- Nine identified Training/plan/Coach-related V1 source tables were queried directly using exact `count(*)`, with an internal per-table row fingerprint used for observation consistency. **No row values or fingerprints are published.**
- V2 target project: `xarhuczrtzuiljmtdaeu`. Separate read-only `to_regclass` check on the same date found all four review-candidate Training restriction owner/evidence tables **not deployed**.

| V1 source table | Observed rows |
|---|---:|
| `public.allin_training` | 1 |
| `public.allin_training_plan_versions` | 0 |
| `public.allin_training_sessions` | 0 |
| `public.allin_workout_user_overrides` | 0 |
| `public.allin_workout_plan_links` | 0 |
| `public.allin_coach_learnings` | 0 |
| `public.allin_coach_thread_facts` | 0 |
| `public.allin_coach_thread_state` | 0 |
| `public.allin_coaching_records` | 0 |

Additional source-only JSON-key observation at **2026-11-13 13:01 UTC** found `preferences.limitation` present as a **nonempty string** in the one Training row; `preferences.notes` also has string type, `draft` is a JSON object with `workouts`, and `accepted` is SQL NULL. The private limitation/notes/workout contents and owner identity were **not retrieved or published**. This is positive evidence of unmapped legacy limitation content, so an empty V2 restriction inventory cannot legitimately be certified until the source owner reviews and maps it or explicitly documents a justified exclusion.

The single `allin_training` record has JSONB `preferences`, `draft`, and `accepted` fields. **One row can encode multiple preferences, plans, injuries, avoided movements, limitations, or other restrictions.** Counts cannot prove their absence or whether other V1 tables, messages, providers, private Storage, or previous snapshots contain relevant information.

A further read-only V1 catalog search for `import`, `sync`, `provider`, `template`, `legacy`, `source`, and `restore` identified `public.allin_workout_sync_sources` and `public.allin_backup_restore_drills` as relevant owner/source-evidence candidates. Exact counts on **2026-11-13** were **zero rows in both**. No separate restriction import-job ledger was identified in this database catalog. This does **not** prove that provider-side or past import jobs never ran; no independently authenticated external import manifest was obtained.

## Acceptance blockers — must stay closed

1. **V1 full source inventory:** Independently inventory every potential legacy restriction-bearing table and JSON path, plus older source snapshots and source-of-record mapping. Capture a pinned encrypted source archive and separately review its complete TOC, owners, row counts, row digests and source acquisition metadata. Do not publish any private artifacts.
2. **Historical transformation:** Explicitly map every verified V1 restriction or exclusion to the canonical V2 Training restriction owner, preserve retired history, and reconcile counts and digests per owner. Record unmatched/ambiguous entries as blockers.
3. **Imports:** Independently inventory all import jobs and external provider/template source snapshots, including zero-row cases with evidence of source scope and completeness. Accepted native plans must not be mislabeled as imported. Validate exact revision-to-restriction links.
4. **V2 hosted restore:** The four restriction candidate tables are absent from current V2; provider physical restore cannot cover them yet. After the schema is independently approved/deployed, collect a new source cutoff, approved provider backup snapshot, pre-start outbound-isolated independent target, restore fingerprint plus per-owner data digests and authorization denials. Existing local two-owner `pg_dump/pg_restore` tests are **engineering evidence**, not hosted provider acceptance.
5. **Certification:** Keep the five-source ingestion adapter private, source observations `exhaustive:false`, and first restriction certification disabled until the independent evidence and reviewers accept every domain.

Neither the observed V1 counts nor a green CI run authorizes deployment, credential changes, legacy-data copying, first certification, or lifting ALL-12.


## 2026-11-13 — Protected source snapshot and isolated restore execution sequence

A source-side read-only catalog/aggregate is now available, but an **actual protected source snapshot has not been acquired**. The Supabase connector available to this task exposes read-only SQL and database management; it does not supply an approved, encrypted, independently authenticated backup artifact or a pre-start-quarantined physical restore. Never substitute copied JSON values or GitHub CI artifacts for those.

- **Before acquiring V1:** authorize a least-privilege source backup identity and a source-scoped table inventory, encrypted offline artifact location, restricted recipients, archive destruction schedule and an independent reviewer. The existing `scripts/all12-capture-approved-logical-backup.mjs` is explicitly pinned to the V2 project; **do not aim it at V1 by editing its environment or bypassing that gate**. Capture V1 only through a separately reviewed V1-scoped operator procedure.
- **Review the V1 limitation:** the source is known to contain one nonempty `public.allin_training.preferences.limitation` value. Keep its contents private. Its athlete owner must authorize an explicit mapping to the canonical V2 restriction owner (including historical status/source/decision evidence) or a reviewer-documented exclusion. Never auto-classify a string as a medical prohibition; never infer zero restrictions from a zero-row auxiliary table.
- **Independent import provenance:** inspect external provider and template import histories, source catalogs, negative/zero-job evidence, revisions and accepted plans. Keep import-job absence **unverified** until the external authoritative history is examined. The existence of zero V1 `allin_workout_sync_sources` rows is not a substitute.
- **Manifest intake:** `scripts/all230-assess-v1-restriction-manifest.mjs` validates an 11-table source manifest, source project, snapshot cutoff, archive digest and custody metadata, limitation mapping disposition, and independently reviewed import manifest. Its `metadataConsistent` result is **not source-authenticity proof or release authorization**. In CI, only synthetic input is used.
- **Hosted restriction restore:** fresh read-only checks show ALL FOUR canonical Training restriction/recovery/evidence tables **absent** on BOTH V2 source `xarhuczrtzuiljmtdaeu` and temporary staging `fbtgknlxjyeqrxemskbl`. The latter is not an approved recovery target. Schema deployment, independent restore destination consent and pre-start egress/job quarantine are prerequisites. Only then may an independently approved provider snapshot be restored and compared using the existing ALL-12 hosted fingerprint and per-owner rule/receipt/digest checks.
- **Certification stays OFF:** five source categories may not be marked exhaustive based on metadata alone. No hosted import, deployed restriction schema, actual first certification or production write occurred in this work.



## V1 operator-only ciphertext snapshot capture (prepared, not executed)

A V1-scoped operator workflow now exists at
`scripts/all230-capture-v1-restriction-source-encrypted.sh`.
It runs **only on a trusted Linux/WSL workstation**, never CI or a production
app worker, and deliberately does not share credentials with V2's
`all12-capture-approved-logical-backup.mjs`.

**Preconditions before any command is run:**

- An explicitly approved V1 source extraction, independent acquisition reviewer,
  restricted backup audience, encrypted offline storage directory (0700),
  retention/destruction policy, and an `age` recipient public key whose private
  key is held separately. The connected Supabase SQL tool cannot supply this
  protected archive or prove the independent recipient's custody.
- PostgreSQL 17 `pg_dump` and `age` installed, a verified TLS connection
  to V1 `impulecgsgaruvniuttc`, and a trusted operator-provisioned
  database password. Never paste passwords or a private encryption key into
  chat, GitHub, CI configuration, issue comments, or shell command history.
- Set `ALL230_V1_CAPTURE_APPROVED=YES`,
  `ALL230_V1_SOURCE_PROJECT_REF=impulecgsgaruvniuttc`,
  `ALL230_V1_SECURE_CUSTODY_APPROVED=YES`,
  `ALL230_V1_ARCHIVE_DIRECTORY`, and
  `ALL230_V1_AGE_RECIPIENT` in the operator's protected shell; also set
  verified `PGHOST`, `PGUSER`, `PGDATABASE=postgres`,
  `PGSSLMODE=verify-full`, and `PGPASSWORD` without logging its value.
  Run `bash scripts/all230-capture-v1-restriction-source-encrypted.sh`.

The script hard-pins **eleven known candidate source tables**, streams
`pg_dump -Fc --data-only` directly to `age` without writing plaintext,
atomically publishes the ciphertext and a separate redacted local receipt,
and deletes incomplete outputs on failure. Neither archive nor receipt
belongs in GitHub or the shared project files.

**Independent verification after capture:** a separate authorized reviewer
must inspect the encrypted file SHA-256, custody/recipient, PostgreSQL TOC
*after decrypting only in a trusted private environment*, exact table
inventory, actual row counts, full V1 scope including other historical
tables/Storage/import providers, and the owner-authorized legacy limitation
mapping. The resulting operator receipt says
`scopeExhaustive:false`, `independentSourceCustodyAccepted:false`,
`importHistoryComplete:false`, and
`initialCertificationAuthorized:false`; it is **not** a provider-issued
backup attestation or hosted restore acceptance.

**Current result (updated 2026-11-13):** the operator reported acquiring the encrypted scoped V1 source archive, locally validating the ciphertext SHA-256 against its capture receipt, decoding its PostgreSQL data, matching all eleven source counts and comparing the one complete Training row digest against live V1. The result is a **locally verified scoped archive and isolated row restoration**, not an independently reviewed source-custody chain, authenticated provider backup, or complete historical/import recovery. No plaintext archive or private key was shared here.


## 2026-11-13 — Expanded V1 source discovery after local scoped restore

Read-only V1 catalog inventory and privacy-safe counts (no owner IDs, free text,
message bodies, source JSON or raw source fingerprints retrieved):

- `public.allin_%` tables in live V1: **183**, including **61** with JSON/JSONB columns.
  This demonstrates that the earlier **11-table restricted ciphertext archive is NOT
  a complete V1 history backup**.
- Additional sources sampled: `allin_coach_messages` **16** rows,
  `allin_profiles` **1**, `allin_integration_health` **15**;
  `allin_profile_goals`, `allin_private_health_conditions`,
  `allin_health_days` and other named Training/import candidates queried had
  zero at the observation time. These counts do not prove absence in other
  providers, snapshots, or unexamined V1 tables.
- **Two of 16 Coach messages** match broad restriction/recovery-related
  keywords, both Coach-authored (none athlete-authored). The founder subsequently
  privately reviewed both and classified both as general advice, **zero V2
  restrictions from those messages**. No message text was retrieved through
  connected tools. The classification is operator/founder-reported, not an
  independently signed review attestation.
- The single `allin_training.preferences.limitation` field is a string
  containing the literal normalized **`none` sentinel**, with zero
  non-sentinel string values at this observation. The owner previously
  reviewed the value locally in the isolated restore. Mapping:
  `no_restriction_declared`; **zero V2 rules created from this field**.
  Preserve the evidence/exclusion decision. This only describes that one
  field, not all historical or currently active restriction sources.
- Repeatable observation query:
  `supabase/tests/all230_v1_extended_source_scope_readonly.sql`
  (executed successfully against real V1 at **2026-11-13 15:24:31 UTC**).
  The local manifest assessor now refuses metadata consistency unless this
  extended catalog is present, the sentinel is explicitly mapped to zero
  created rules, and the independently reviewed Coach-message/candidate
  source evidence is supplied. This is review logic, not signed source
  authenticity.

**Release gates:** keep `fullHistoricalCoverageEstablished=false`,
`externalImportJobHistoryVerified=false`,
`initialCertificationAuthorized=false`, and the hosted restriction restore
blocked. Preserve founder's private message-review disposition in an independently
verifiable, privacy-preserving receipt before external source certification;
do not send message contents to GitHub/Linear/ChatGPT. Do not transplant Coach
free-text into a V2 medical restriction automatically. The V2 Training
restriction schema remains a review candidate.

**Recovery limitations:** the local subset restore intentionally used pre-data
table definitions plus three V1 validation functions. It did **not** recover
the full `auth.users`/profile-goal FK graph, post-data constraints, private
Storage, full V1 history or a provider-managed hosted physical recovery.


## 2026-11-13 — External-import signals and V1 relational dependency audit

New repeatable read-only original-V1 query:
`supabase/tests/all230_v1_import_relational_recovery_inventory_readonly.sql`.
**Executed** on `impulecgsgaruvniuttc` at **2026-11-13 16:55:00 UTC**.
Metadata/aggregate evidence, no account identifiers or private row contents:

| Source or dependency | V1 result |
|---|---:|
| Original scoped Training/Coach tables | 11 |
| Original scoped foreign keys | 17 |
| Foreign keys pointing outside the scoped 11-table archive | 11 |
| Referenced external tables | `auth.users`, `public.allin_profile_goals` |
| `auth.users` | 1 |
| `allin_profile_goals` | 0 |
| `allin_workout_sync_sources` | 0 |
| `allin_race_provider_results` | 0 |
| `allin_race_result_provider_mappings` | 0 |
| `allin_backup_restore_drills` | 0 |
| `allin_integration_health` | 15 |
| `allin_ai_model_route_history` | 3 |

Read-only source catalog independently confirms **all 17 V1 FK constraints
were validated in the original V1 database**; this does **not** verify
that they were re-created or enforced in the isolated restore. The local
restore has a verified single Training row and zero other scoped rows,
but did not restore `auth.users`, `public.allin_profile_goals`,
post-data constraints, Auth identity/session machinery, or Storage.

No provider-issued import job list or historical provider-side activity
inventory was obtained. Zero current rows in named import sink/source
tables is **not** independent proof that no previous import jobs
occurred: historical jobs can have been deleted, moved, or stored by
external providers. Do not set `negativeZeroJobProofVerified=true`.
Original V1 has 183 `allin_*` public tables (61 JSON-bearing), of
which the independently encrypted subset contains 11. A full inventory
of historical restriction-bearing records and imported-source provenance
is **still missing**; this cannot be accepted from scoped backup counts.

Note the founder's explicit, separately tracked ALL-230 **lying-leg-curl
exercise restriction**: the legacy V1 `limitation='none'` sentinel
means only that *one legacy field* contains no recorded limitation.
It cannot overwrite or retire the later explicit V2/ALL-230 workout
restriction. Never mint or erase rules from a generic `none` sentinel.

**Provider backup/restore:** the live-source FK audit, local encrypted
scope restore and existing offline ALL-12 acceptance scripts are not a
Supabase-managed restore. No provider snapshot ID, verified separate
restored project, full Auth+Storage recovery evidence, RPO/RTO or
approvals were established this turn. Hosted recovery gate remains
blocked and no paid project was provisioned.


## 2026-11-13 — Full 236-table cross-schema source-count expansion

The original V1 database was queried **read-only** for the complete
`public.allin_*` 183-base-table inventory and then for the other 53 base
tables in `public`, `allin_private`, `auth` and `storage`. These
four schemas contain **236 base tables, 54 nonempty tables and 15,526 rows**
at the observations (183/38/13,053 plus 53/16/2,473). No private row
contents, athlete UUIDs, auth secrets, or Storage file bytes were selected.

The repeatable frozen 183-table SQL baseline is
`supabase/tests/all230_v1_historical_allin_table_counts_readonly.sql`,
created at commit `711c7c1` and **executed against original V1**
at **2026-11-13 17:01:19 UTC** with exact 183/183 catalog-membership
match, 38 nonempty tables, and 13,053 rows. This remains a *current
catalog/row-count observation*, not a historical cutoff snapshot.
The other 53 tables included 16 nonempty with 2,473 rows. Significant
recovery dependencies: `auth.users`=1, `auth.identities`=1,
`auth.sessions`=5, `auth.refresh_tokens`=65,
`storage.buckets`=6, `storage.objects`=522.
The 522 object records are **metadata, not proof of file byte availability**.

**Independent external import/provenance is still not verified.**
Current zero-count `allin_workout_sync_sources` and
race-provider-result/mapping tables cannot independently attest that
historical third-party import jobs never existed. A provider-issued job
history, independently controlled acquisition cutoff/custody evidence,
or an explicit approved external-source coverage statement is required.
No `negativeZeroJobProofVerified` flag is authorized.

**Auth recovery is NOT a simple copy of current sessions or refresh
tokens.** Treat active refresh material, password verifiers and identity
records as restricted security data; restore only with independently
approved encrypted custody and a managed Auth recovery plan that avoids
reusing live credentials. Do not manufacture local auth.users owner rows
from Training foreign keys. A genuine Auth schema/identity recovery is a
precondition to validating the 17 original FK edges.

The 17 *exact original* FK definitions, captured solely from live V1
metadata, are pinned in the **review-only, offline-only** file
`supabase/tests/all230_v1_original_17_fk_offline_candidate.sql`
(commit `a70fd35`). No FK DDL was applied to any database in this
work. The guarded operator script
`scripts/all230-restore-v1-original-fks-offline.sh`
(commit `fc2d63d`) refuses if the expected Docker target is
network-connected, has ports, lacks tmpfs, lacks restored Auth
users/identities/sessions or profile-goal schema, lacks a real
Training/Auth owner relationship, or lacks separate documented genuine
source and FK-install approval. It uses atomic FK application and checks
17 validated definitions against live V1's schema-only fingerprint
`cb8a4806420ab2b409bef8736678ff59`.
**The current isolated restore does not have authentic Auth, so that
script must BLOCK rather than fabricate identity data.** A successful
FK-only run would still not prove valid Auth sign-in or hosted recovery.

**Snapshot/restore gates still open:**
1. approve a complete source scope and personally protected encrypted
   custody, including Auth, all owned domains and actual private Storage
   object bytes; specify retention/destruction and approved reviewer;
2. obtain independently verifiable provider/import job and snapshot
   provenance evidence with consistent cutoff; avoid promoting
   concurrent live counts to a snapshot receipt;
3. restore real Auth/schema/rows into a separate isolated environment
   with secrets and outbound effects controlled, then apply and verify
   all 17 FKs; test actual reauthentication without live credentials;
4. prove Storage file bytes, owner isolation, schema/domain digests,
   provider restore ID, observed RPO/RTO, and reviewer acceptance.

No additional Supabase projects, paid branches, hosted backups, live
schema modifications or source-private exports were executed in this
turn. Do not mark ALL-12, ALL-230, or first restriction certification
complete.
