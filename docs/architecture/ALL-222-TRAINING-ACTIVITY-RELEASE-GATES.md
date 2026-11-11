# ALL-222 / ALL-243 / ALL-246 — Canonical Training + Completed Activity release gates

**2026-11-11 authoritative basis:** V2 repo `allinproject/All-In-V2`, branch `integration/v2-foundation`; live V2 Supabase `xarhuczrtzuiljmtdaeu` contains **zero** canonical Training, Completed Activity or Activity evidence tables. All current SQL lives in review-only `docs/architecture/sql/*-CANDIDATE.sql`, not an approved deployment migration. V1 data must never be copied implicitly. ALL-253 global weekly competitions remain disabled.

## Completed, verified **in disposable PostgreSQL 17**

- One assembled Training plan → accepted revision → exact scheduled execution → finish → one outbox → pending Completed Activity → owner-bound source → typed metric → unverified Weekly Challenge attempt. [Integrated replay](../../scripts/test-v2-training-completed-integrated-release-postgres.psql).
- Anonymous and authenticated **actual PostgreSQL roles** cannot directly read/write candidate tables or execute review-only functions, and even temporary SELECT grants are blocked by deny-by-default RLS. [Actual role replay](../../scripts/test-v2-training-completed-real-role-postgres.psql).
- Two independent PostgreSQL connections racing to **start** produce exactly one active session, one accepted action receipt and one event; separate concurrent **finish** calls produce one completed session, one outbox and one rejected stale request. [Start setup](../../scripts/test-v2-training-two-connection-setup-postgres.psql) / [start assertions](../../scripts/test-v2-training-two-connection-assert-postgres.psql); [finish setup](../../scripts/test-v2-training-two-connection-finish-setup-postgres.psql) / [finish assertions](../../scripts/test-v2-training-two-connection-finish-assert-postgres.psql).
- All replay jobs run in the [no-deploy PG17 workflow](../../.github/workflows/v2-training-completed-postgres.yml), not hosted Supabase. Passing these tests does **not** establish production authority.

## Mandatory owner decisions before a live migration

1. **ALL-222 / 243 / 246:** approve the final immutable owner/reference schema, versioned operations and Sports metrics coverage; choose additive migration order and explicit rollback/restore acceptance. The proposed public `SECURITY DEFINER` Auth gateway is **NOT** granted to clients; requires real Supabase Auth account+session replay, hardened grant surface and security review before considering activation.
2. **ALL-251 — account export:** current `20261111134456_v2_owner_bound_current_data_export_snapshot.sql` uses a **fixed current-table allowlist** and intentionally raises `42501` on any new user-owned table. The new Training/Activity tables will trigger this gate. **Do not deploy without implementing and testing export coverage for the entire new graph**, and any retained private records. This is a concrete release dependency, not an export failure today.
3. **ALL-251 — account deletion:** current `20261111123939_v2_deletion_claim_fail_closed_storage_and_owner_coverage.sql` requires owner table `ON DELETE CASCADE` to `auth.users`. Several candidate child entities rely on indirect owner composite FKs, so the future release must explicitly verify deletion cascade coverage and account completion across *every* owner/private table, including delayed outbox jobs and archived sources. Do not weaken deletion's fail-closed gate or assume a completed export exists.
4. **ALL-245:** trusted Watch/HealthKit/FTMS power source identity, actual metric evidence, source reconciliation, race/reconnect coverage, optional private Storage bucket and its owner-bound access policy, redaction of route location, checksum/object existence checks. No client-attested verified power.
5. **ALL-253:** competition server-side scoring / final audit and ranking, immutable attempt baseline and a real FTMS qualification acceptance program. Default-off generation/publication/finalization controls remain locked until explicitly accepted.
6. **App/device:** implement authenticated canonical session actions and safe reads; validate actual phone/Watch device behavior, pause/resume/offline, imported-only history, screen-level completion and user recovery. Do not represent SQL mock tests as installed-app acceptance.

## Staged deployment protocol

- Refresh current integration head, live migration history, auth/privacy owner and concurrently changed issues **again** immediately before preparing an actual migration.
- Produce a reviewed additive migration from the final approved schema in the owning V2 migration workflow; do not replay the 938 V1 migrations or copy V1 user accounts. Run full-graph disposable replay and actual-role grants, 2-connection races, restore/recovery and export/deletion tests on the exact proposed migration.
- No public/anonymous direct writes to raw evidence, score, plan history or owner private tables. Explicit limited endpoint authorization only after real Supabase Auth token/session checks.
- Deploy with releaseReady=false and all competition/worker/cron gates OFF, with independent rollback and recovery acceptance. A live deployment is a separate consequential decision, never inferred from successful candidate tests.
- Verify live schema, grants, RLS, advisory warnings, producer/consumer API versions and installed-app upgrade compatibility before lifting any gate.

**As of this checkpoint, these are release blockers rather than completed live behaviors.**
