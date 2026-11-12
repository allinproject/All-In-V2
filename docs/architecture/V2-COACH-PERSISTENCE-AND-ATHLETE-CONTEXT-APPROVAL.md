# V2 Coach persistence and athlete-context schema approval packet (ALL-222)

**Status:** Founder Stage-1 Coach architecture principles **APPROVED** on 2026-11-12 for isolated/staging implementation only; final versioned DDL, production migration, retention/legal publication and user activation **NOT APPROVED**.  
**Authority:** `docs/architecture/V2-DOMAIN-OWNERSHIP-SECURITY-AND-EVENT-CONTRACTS.md`, ALL-210, ALL-217, ALL-232, ALL-240, ALL-241.  
**Backend:** isolated V2 Supabase `xarhuczrtzuiljmtdaeu`.  
**Snapshot:** 2026-11-11. Live V2 currently has no Coach thread/message tables or Coach Edge Function. The V1 deployed Coach v18 is reference, not a V2 endpoint.

## 1. Ownership and boundaries

Coach runtime (ALL-217) owns its **conversation** and immutable message receipts, thread lifecycle, thread-scoped settled discussion state, and model/provider metadata. It does **not** own athlete goals, plan versions, workouts, activity history, exercise exclusions, food consumed, equipment or recovery facts. Those stay with ALL-239/246/243/247/236/238 and their respective canonical writers. ALL-232 composes bounded, coverage-aware athlete context from those owners. ALL-240 owns allowed action/approval/result semantics. ALL-210 wires the mobile client after these contracts exist.

Never substitute a local chat cache, model-generated summary or V1 database call for authoritative V2 persistence. New V2 accounts get new V2 threads; do not silently migrate the founder's V1 messages.

## 2. Review-only physical table proposal

All owner-scoped keys reference `auth.users(id)`; migrations must explicitly set RLS and least-privilege grants. Names below are proposed and must be reconciled with other in-flight ALL-222 migrations **before** creating anything.

| Proposed object | Primary/unique keys | Essential columns and invariant | Owner / write path |
|---|---|---|---|
| `public.v2_coach_threads` | `id uuid PK`, `unique(user_id, id)` | `user_id uuid not null`, `created_at`, `updated_at`, `archived_at nullable`, `version bigint > 0`; active-thread selection is explicitly owner-scoped and deterministic; archival does not delete message identity | Coach lifecycle writer |
| `public.v2_coach_messages` | `id uuid PK`, `unique(user_id, thread_id, client_message_id)` for non-null client IDs; `unique(user_id, thread_id, server_response_id)` for non-null response IDs | `user_id uuid not null`, `thread_id uuid not null`, `role enum/checked text (user, assistant, system_event)`, bounded `content`, `created_at`, `client_message_id`, `server_response_id`, `reply_to_message_id nullable`, `status` (accepted, failed, delivered), `model_request_id nullable`; composite FK `(user_id,thread_id)` to threads prohibits cross-owner linkage | Canonical append RPC; never generic direct INSERT |
| `allin_private.v2_coach_message_actions` | `PK(user_id, client_action_id)` | Operation, thread ID, payload fingerprint, persisted message/result IDs, timestamps; exact retry returns same receipt; changed payload/target on same ID rejects | Private append/lifecycle idempotency ledger; no client table access |
| `allin_private.v2_coach_settled_context` | `PK(user_id, thread_id, context_key)` | Small bounded thread-local summary, source message boundary, version, expiration/recompute metadata; explicitly **not** a durable athlete profile or domain-fact writer | Server-only derived/rebuildable context; optional, deferred until needed |

**Critical invariants:** composite owner/thread keys; user ID derived from authenticated principal, never trusted from client body; server-generated response IDs persisted atomically; client action IDs stable across retries; assistant reply receipt references the originating turn; pagination uses stable `(created_at,id)` cursor; append-only accepted messages (corrections are new messages/events); bounded payload size, retention and deletion policy approved before launch. A client may locally render an optimistic pending bubble but must reconcile it to the authoritative message ID, not duplicate it.

## 3. RPC/Edge and security approval matrix

| Proposed operation | Allowed caller | Expected actor and authorization | Replay and return |
|---|---|---|---|
| `v2_coach_get_or_create_thread` | authenticated client via narrowly granted RPC | `auth.uid()` required; only own thread, deterministic canonical thread choice; no arbitrary owner parameter | Returns stable thread ID, version; concurrent first-open must not create competing canonical active threads |
| `v2_coach_read_messages` | authenticated client via bounded RPC or owner-RLS SELECT | Thread belongs to `auth.uid()`; explicit maximum page size and cursor | Stable ordered page, thread metadata; empty not evidence of another owner's history |
| `v2_coach_append_user_message` | authenticated client via RPC | Owner matches `auth.uid()`, thread belongs to owner, length/role checked; caller action ID and payload fingerprint required | On accepted write returns canonical message ID; duplicate identical request returns same ID |
| `v2_coach_record_assistant_reply` | trusted V2 Coach Edge/service-only writer | Re-verify JWT user through V2 Auth, bind request to exact owner/thread/user message and server response ID; never accept assistant role from mobile | Single response receipt/ID on retry, no cross-owner writes |
| `v2_coach_context_for_turn` | V2 authenticated Coach Edge service only | Request identity bound to V2 owner; task-gated per-domain readers and consent/visibility gates, not unrestricted client table dumps | Structured source IDs, version, observed/recorded/retrieved times, source coverage and freshness; explicit unknown/partial states |
| Domain apply | **Only** specific approved domain writers | ALL-240 capability token/action, exact object ID, expected revision, explicit athlete approval | Canonical receipt **and read-back** required before Coach claims success |

RLS: threads/messages allow owner-scoped SELECT only for authenticated roles; no direct user DELETE/UPDATE/INSERT (all writes via narrow RPC). Private ledger/settled context has RLS enabled and no anon/authenticated grants or policies; service/database functions require secure `search_path`, strict parameter checks and no unnecessary generic EXECUTE grant. Test effective grants and function EXECUTE privileges under `anon`, `authenticated`, `service_role` and owner-mismatched sessions rather than relying on RLS declarations alone. Enforce account-deletion cascade and privacy export coverage; do not put health notes or third-party secret/provider payloads in chat telemetry.

## 4. Canonical athlete-data read contract

Per answer, request only relevant current records via the domain owner. Minimum typed envelope: `owner_id`, `source_domain`, `source_object_id`, `revision`, `event_at`, `retrieved_at`, `coverage` (`complete|partial|unknown`), `confidence`, `consent_scope` and `payload` bounded by task. Cache must invalidate on owner switch, accepted plan/goal/restriction revision and consent withdrawal. No stale cached fact may outrank a fresh canonical record.

Priority: current accepted structure + hard exclusions > fresh relevant observations > dated historical evidence > prior conversation/discussion > generic model suggestion. A statement such as “I cannot do lying leg curls” is a **proposed correction** until saved to the responsible restriction owner; the model must honor it during the current conversation and seek canonical confirmation for future turns. Missing food entries are unknown intake, not zero consumption; unsynced device intervals are unknown, not inactivity; discussed plans are not completed or accepted plans. Health considerations are opt-in, revocable and not exposed to Coach without the active consent gate.

## 5. Failure and regression acceptance before approval/deployment

1. Owner A sends and rereads a message; a retry yields **one** accepted row; same action ID with different body fails.
2. New install, navigation, token refresh, cold restart and multi-device reentry resolve the same current thread/history.
3. Owner switch during fetch or in-flight model reply drops stale response and never displays A's messages to B.
4. Authenticated B cannot read/write A's thread or guess another thread UUID. Service/Edge cannot cross-bind user/thread IDs.
5. Concurrent first-open and append are race-tested; cursor pagination has no gaps/duplicates on equal timestamps.
6. Assistant failure/rate limit preserves the accepted user message and truthful failure status; retry never duplicates a reply.
7. New current approved plan/restriction outranks an old Coach reply; absent reader, unsynced coverage, revoked consent and stale revision are surfaced honestly.
8. A proposal, approval, attempted writer and confirmed read-back are distinct states; canceled or failed writes are never described as saved.
9. Export/deletion and retention work for thread, messages, private derived context, idempotency receipts and telemetry.
10. Clean database migration, authenticated + cross-owner integration, Postgres grants/RLS, mobile restart and live V2 Edge tests all pass. Source-only parser tests do not count as production acceptance.

## 6. Review gates and implementation sequencing

**Gate A — ALL-222:** Agree on canonical active-thread policy (one ongoing vs optional multiple), authoritative role/status enums, assistant writer identity and transactional boundaries, metadata/retention limits, RLS/grant surface, migrations and privacy/deletion handling; update final physical ERD. This document is the **candidate** for that review, not approval.

**Gate B — ALL-217 / ALL-210:** Implement one V2-owned migration + tested canonical RPC/Edge writer, then wire existing typed Coach client; do not call V1 `allin-coach` with a V2 token or treat V1 v18 as deployed V2.

**Gate C — ALL-232 / ALL-241:** Connect real domain readers once their canonical records exist. Validate complete/partial/unknown coverage, freshness, consent, corrections, action receipts and end-to-end mobile journeys across athlete types.

**Deployment:** None authorized by this packet. Keep ALL-222, ALL-210, ALL-217 and ALL-241 open until evidence proves their respective acceptance gates.


## 7. First physical SQL and security acceptance candidate — 2026-11-11

The following are **review-only** source files under `docs/architecture/sql/`, deliberately **outside** `supabase/migrations/` so they cannot be auto-applied:

- [V2-COACH-PERSISTENCE-CANDIDATE.sql](./sql/V2-COACH-PERSISTENCE-CANDIDATE.sql): one permanent V2 conversation per authenticated account; owner/thread composite foreign keys; role-checked, append-only messages; unique client action and service response identifiers; private successful-append ledger; owner-bound first-open and append RPCs; service-role-only assistant writer; paginated history reader; table RLS and narrow EXECUTE grants.
- [V2-COACH-PERSISTENCE-SECURITY-CHECKS.sql](./sql/V2-COACH-PERSISTENCE-SECURITY-CHECKS.sql): executable **local-only** catalog assertions for relation RLS, direct table-grant denial, RPC presence, and assistant-writer privilege boundaries, followed by required behavioral replay checklist.

**Proposal refinement:** The SQL candidate implements three tables now and deliberately defers the optional settled-context table, because conversation replay can work without a second summarized state. The selected active-thread policy is one durable thread per owner; future multiple-thread support would require an explicitly reviewed schema transition. Failed service calls do not create successful assistant messages. Accepted user messages remain in history and service failures must be represented truthfully in the application.

**Later verification update (2026-11-12):** The candidate **has passed** disposable local PostgreSQL security, two-owner integration and independent-session race tests in [CI run #43203104074](https://github.com/allinproject/All-In-V2/actions/runs/43203104074). This supersedes the original pre-execution status of this section. Stage-1 founder architecture approval is recorded below; no hosted migration or production Coach service is approved. Privacy export/deletion scope, secure service integration, domain data and installed-app continuity remain separate release gates.

## 8. Disposable foundation CI integration — 2026-11-12

The existing `.github/workflows/v2-foundation-clean-replay.yml` now runs this packet's candidate DDL and security smoke using the **same local CLI Supabase PostgreSQL service**, after replaying the actual committed V2 migrations. The workflow only uses `docker exec` into `supabase_db_` and has no remote database/linked-project execution path for Coach.

The owner-replay [SQL script](./sql/V2-COACH-PERSISTENCE-TWO-OWNER-LOCAL.psql) creates only synthetic Auth IDs inside a transaction and rolls them back. It checks exact user-message idempotency, changed-payload rejection, authenticated B's inability to access A's thread, direct table denial, assistant-writer authorization, assistant retry and cross-owner write prevention, message/ledger counts, and direct Auth deletion cascade without removing B's record. These are assertions **to execute**, not evidence of passing behavior.

**Evidence distinction:** repository commit `1be4f41481e375b1cba03e31bb3468ae54883360` added CI wiring; later source hardening `983a95d5fe397458ad361b38eab7549434b78027` strengthened negative/privacy cases. There is **no observed successful Coach CI run in this record**. Do not interpret workflow registration as an executed PASS. Once logs are obtainable, record the specific run and step statuses; on failure, fix the underlying SQL/test bug before another acceptance claim.

**Still missing for final ALL-222 approval:** concurrent first-open across independent DB sessions; concurrent same-action append; stable equal-timestamp pagination; account export integration, retention and deletion-policy review; tested absence of cross-owner access using actual mobile Auth JWTs and a hosted V2 Edge invocation; migration ordering and upgrade/rollback; installed-device restart/account switch. Keep Coach candidate outside deployable migration folder until accepted.

## 9. Production migration approval readiness review — 2026-11-12

**Decision:** **NO-GO for executing the Coach migration against hosted V2 at this time.** Approval of *design direction / staged migration preparation* is separable from production SQL authorization. This review does not approve either production migration or opening Coach to real users. All SQL remains in `docs/architecture/sql/` outside the versioned migration sequence.

**Verified isolated evidence:** [foundation workflow #43203104074](https://github.com/allinproject/All-In-V2/actions/runs/43203104074), code SHA `b8bfc5a5a5829a2033e6472ee59392127c428e9b`, completed SUCCESS. The Coach source checks, real local PostgreSQL DDL/RLS/grant/two-owner persistence/security test, and independent-session first-open/append race steps each passed. Disposable PostgreSQL success does *not* establish hosted rollout, mobile continuity or privacy lifecycle.

**Live authority snapshot:** V2 Supabase project `xarhuczrtzuiljmtdaeu` has 18 applied foundation migrations, no Coach tables, and its deletion processor is default OFF. The current versioned migration `20261111134456_v2_owner_bound_current_data_export_snapshot.sql` explicitly **fails closed** if any owner-scoped table not in its known allowlist is present. The proposed Coach tables `public.v2_coach_threads`, `public.v2_coach_messages` and `allin_private.v2_coach_message_actions` have `user_id` columns and are **not allowed/exported** by that current function. Deploying candidate DDL alone would therefore break owner export. Existing `ON DELETE CASCADE` relationships do not by themselves prove the disabled deletion *worker* completes the entire lifecycle.

### Gates needed before a production authorization

1. **Privacy export and deletion bridge (blocking).** Extend the existing canonical `public.v2_export_my_account_snapshot` implementation, not a second export system, to include Coach thread/message/action data for the authenticated owner. Preserve the fail-closed unknown-owner-table rule, 5 MB inline cap and secure large-export path. Test owner A/B separation, empty and populated exports, completeness, large histories, and delete/re-register without leaking old messages. Reconcile with the account deletion processor's owner-table coverage, export preflight, backup/retention obligations and privacy/legal sign-off. Never permit a destructive worker to run merely because Coach FKs cascade.
2. **Schema contract review (blocking).** Explicitly approve one durable thread per owner, minimal `user|assistant` roles and accepted-message-only storage, bounded 32 KiB message content, independent client action/assistant response IDs, exact idempotency behavior, and no optional settled-context table yet. Confirm rejected/failed assistant messages are honestly rendered by the app without inventing a persisted success state. Align candidate names with ALL-210/217 typed client contract and migration naming conventions.
3. **Auth/Edge service review (blocking before Coach endpoint activation).** `service_role`-only assistant reply RPC is privileged and accepts owner ID as a parameter. Confirm production Edge verifies the *user's* V2 Auth session and binds exact owner/thread/user-message before any service-role request; never expose the service token to mobile. Audit default PUBLIC function privileges, effective grants and definer ownership after real migration replay. Keep the endpoint inactive until complete.
4. **Release migration and rollback (blocking).** Compose versioned, ordered, forward-only migration(s) covering the Coach schema **and canonical export/owner-lifecycle bridge atomically or safely sequenced**. Do not deploy a partial stage in which Coach DDL is live but export errors. Test versioned local migrations, populated account upgrade, exact RLS/readback, rollback/recovery in independent representative backup/restore rehearsal, staging/prod parity, and deployed schema postflight. Record an explicit maintenance/abort plan; direct rollback that drops real Coach messages is prohibited.
5. **Device and end-to-end acceptance (blocking before user launch).** Real V2 Auth tokens, cold restart, owner switch while requests are pending, app update, denied/revoked consent, offline/retry and server failure recovery, Coach context provenance and canonical domain writers. No V1 endpoint fallback or fabricated saved actions.

### Approval scope proposal for founder review

- **May approve now:** The *product/schema principles* (one persistent private owner-scoped thread; append-only messages; no cross-owner access; idempotent retries; private service-owned assistant replies; existing account export/deletion lifecycle extended instead of duplicated), and continued **local/staging-only implementation and testing**.
- **Not yet approve:** A specific final versioned SQL hash, hosted V2 migration, live permission changes, Coach endpoint activation, production Coach traffic, opening signup or final data retention/legal policy.

A production go/no-go decision must name the exact versioned migration hashes, updated export/deletion writer, staging run/test evidence, representative restore evidence, operational rollback/abort readiness and a *separate explicit authorization*. ALL-222 stays In Progress.

## 10. Founder Stage-1 approval and canonical export integration — 2026-11-12

**Approved by founder:** Coach persistence architecture principles and continued **isolated/staging** implementation, including extending the **existing** account export and deletion workflows. **NOT** approved: hosted migration, production ACL changes, release endpoint deployment, or opening Coach to users. Decision recorded in [ALL-222](https://linear.app/allin365/issue/ALL-222).

Existing canonical account export implementation for new owner domains is the review-only `docs/architecture/sql/V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql`. It has been extended **in place**, not copied to a competing user export API, to add `coach_conversation.threads`, `.messages`, and `.message_actions`, each filtered by the authenticated user ID. Its exact known-owner-table allowlist includes all three Coach owner relations; the previous 5 MB inline-size and unknown-table/Storage fail-closed safeguards remain. The existing Training/Activity fragment remains present. This is **not** a complete download workflow; overly large exports require the separately approved secure large-export path.

The companion `scripts/test-v2-coach-account-export-local.psql` checks own-data inclusion, two-owner separation, cross-owner denial, and direct Auth deletion cascade with rollback-only synthetic fixtures. The existing disposable V2 foundation workflow is configured to run it after the Training/Activity export bridge. Successful CI execution must be observed before claiming acceptance. Importantly, **all concurrent candidate domains with `user_id` tables** must also be covered by the canonical export allowlist *and* actual JSON export payload before the full end-to-end export can pass. Do not merely widen the allowlist without exporting the matching records. This work does not turn on the hosted deletion processor or authorize production migration.

## 11. Stage-1 validation outcome and explicit cross-domain export dependency — 2026-11-12

The approved Stage-1 Coach DDL now includes a **direct** `auth.users(id) ON DELETE CASCADE` owner FK on messages in addition to composite owner/thread keys, matching ALL-251's existing deletion preflight. Existing Coach threads and private message actions also have direct Auth cascades. The SQL candidate revokes direct `service_role` table privileges and retains the narrow, trusted assistant-reply RPC; the local security/catalog acceptance checks now enforce both the direct FKs and service-table grant denials.

[Disposable GitHub Actions run #43217183088](https://github.com/allinproject/All-In-V2/actions/runs/43217183088) at exact code head `50c855e3a5ed4dcdb0da717ddcacc4eb4490d886`: **PASS** for Coach SQL source guard, real local PostgreSQL Coach RLS/grants, two-owner persistence, direct Auth deletion-cascade checks, independent concurrent request race, and the existing Training export bridge. **FAIL** for the newly added canonical full-account export integration replay because the existing unknown-owner-table guard correctly rejects **nine in-flight non-Coach user-owned tables**:

- Goals / ALL-239: `public.v2_goals`, `public.v2_goal_revisions`, `public.v2_goal_revision_behavior_targets`, `allin_private.v2_goal_acceptance_actions`, `allin_private.v2_goal_approval_reviews`.
- EventHub / ALL-244: `public.v2_event_group_memberships`, `public.v2_event_participations`, `allin_private.v2_event_group_actions`.
- Community / ALL-244: `allin_private.v2_community_visibility`.

The nine qualified identities come from the actual PostgreSQL catalog emitted by the diagnostic in `scripts/test-v2-coach-account-export-local.psql`, not a guessed file inventory. **Do not waive the guard.** ALL-251 and the Goals/Community/EventHub domain owners must explicitly reconcile owner-only payloads, relationship redactions, retention and export limits in the **same canonical** `public.v2_export_my_account_snapshot`. The review-only Coach extension already includes Coach threads, messages and action receipts, but **end-to-end canonical export has not passed** and the 5 MB inline limit still requires a separate secure large-export path. The user's Stage-1 approval does not authorize hosted schema rollout, service activation or production traffic. Keep ALL-222 In Progress.
