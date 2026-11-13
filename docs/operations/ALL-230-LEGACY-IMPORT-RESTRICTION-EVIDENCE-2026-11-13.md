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

The single `allin_training` record has JSONB `preferences`, `draft`, and `accepted` fields. **One row can encode multiple preferences, plans, injuries, avoided movements, limitations, or other restrictions.** Counts cannot prove their absence or whether other V1 tables, messages, providers, private Storage, or previous snapshots contain relevant information.

## Acceptance blockers — must stay closed

1. **V1 full source inventory:** Independently inventory every potential legacy restriction-bearing table and JSON path, plus older source snapshots and source-of-record mapping. Capture a pinned encrypted source archive and separately review its complete TOC, owners, row counts, row digests and source acquisition metadata. Do not publish any private artifacts.
2. **Historical transformation:** Explicitly map every verified V1 restriction or exclusion to the canonical V2 Training restriction owner, preserve retired history, and reconcile counts and digests per owner. Record unmatched/ambiguous entries as blockers.
3. **Imports:** Independently inventory all import jobs and external provider/template source snapshots, including zero-row cases with evidence of source scope and completeness. Accepted native plans must not be mislabeled as imported. Validate exact revision-to-restriction links.
4. **V2 hosted restore:** The four restriction candidate tables are absent from current V2; provider physical restore cannot cover them yet. After the schema is independently approved/deployed, collect a new source cutoff, approved provider backup snapshot, pre-start outbound-isolated independent target, restore fingerprint plus per-owner data digests and authorization denials. Existing local two-owner `pg_dump/pg_restore` tests are **engineering evidence**, not hosted provider acceptance.
5. **Certification:** Keep the five-source ingestion adapter private, source observations `exhaustive:false`, and first restriction certification disabled until the independent evidence and reviewers accept every domain.

Neither the observed V1 counts nor a green CI run authorizes deployment, credential changes, legacy-data copying, first certification, or lifting ALL-12.
