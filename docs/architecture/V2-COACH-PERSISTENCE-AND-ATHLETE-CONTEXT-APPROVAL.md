# V2 Coach persistence and athlete-context schema approval packet (ALL-222)

**Status:** Proposed physical contract for review; not approved DDL, not deployed.  
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

**Not yet proven:** The candidate has not been executed against a disposable PostgreSQL/Supabase instance. The catalog checks and two-owner authenticated integration replay have **not** run. These files are not approved for production migration. Privacy retention/export/deletion scope, secure service writer implementation and exact integration with currently in-flight ALL-222 physical schema work remain approval gates. A proposed SQL file is not equivalent to a working V2 Coach service.
