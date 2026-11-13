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

