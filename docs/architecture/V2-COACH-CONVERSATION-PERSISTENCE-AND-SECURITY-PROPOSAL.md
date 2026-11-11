# ALL IN 365 V2 — Coach conversation physical-owner and persistence contract (ALL-217)

**Status:** Proposed physical contract; **NOT a deployed migration or live feature**. Requires ALL-222 ownership/RLS review, database replay, and signed-off V2 Coach runtime.  
**Canonical database:** V2 Supabase project `xarhuczrtzuiljmtdaeu`; never depend on V1 runtime data.  
**Source:** V1 `allinproject/ALL-IN` integration reference, inspected 2026-11-11. Only approved behavior is ported.

## Confirmed V1 implementation (do not guess the writer)

- `Native/src/data/coachClient.ts` `sendNativeCoachMessage` calls the Coach Edge Function through `invokeNativeCoach`, then `persistNativeCoachExchange`. This writer invokes authenticated `allin_append_coach_exchange` and returns `persisted` plus the exact user/assistant message IDs. The UI surfaces an unsaved exchange and retries *the same IDs* before allowing the thread to continue.
- `supabase/migrations/20261025141320_coach_persistent_exchange_v1.sql`: one transaction inserts the two messages and verifies ID+owner+thread+role+content. Old client-direct inserts exist and are **not** a security pattern for V2.
- `supabase/migrations/20261026203748_coach_turn_idempotency_foundation.sql` and later claim-abuse/stale-execution hardening introduce private request claims with fingerprint, processing lease, completed replay and failure state. They protect against duplicate expensive provider calls and ambiguous retries; review their full security and policy dependencies before adapting them.
- The inspected v18 Edge handler reads `recentConversation` and `loadContinuityContext` but does not visibly append exchanges itself. This is consistent with the separate V1 mobile writer; **the V2 writer must be explicitly assigned** and cannot be inferred from Edge behavior.

## Canonical owner boundaries

Coach (ALL-217) owns **only** its own conversation-thread identities, immutable user/assistant turns, and minimal request/response/canonical result references. Training, Race, Gear, Fuel, Pantry, Cookbook, Recovery, Profile, and other domains own their facts and writes. Coach cannot copy an accepted workout/meal/goal into its tables or treat conversational assertions as proof of those records.

Proposed initial V2 physical objects, pending ALL-222 review:

| Proposed object | Responsibility | Access |
| --- | --- | --- |
| `public.v2_coach_threads` | UUID thread, `user_id` authenticated owner, created/updated time and optional archived flag | Authenticated owner SELECT; create/archive only through narrowly scoped owner functions |
| `public.v2_coach_messages` | Immutable UUID message, thread+owner FK, role `user|assistant`, bounded content, created time, request correlation and optional verified owner-result reference | Authenticated owner SELECT only; paired INSERT only through canonical Coach writer |
| `allin_private.v2_coach_turn_claims` | Exact request+owner+thread+fingerprint, assistant ID, lease/failure/replay state, rate-cost protection | Server-managed only, not API-exposed, RLS/least privilege |
| `public.v2_coach_create_thread` (candidate) | Auth-bound thread creation; returns own thread ID | Authenticated EXECUTE only |
| `public.v2_coach_append_exchange` (candidate) | One **atomic** user+assistant insertion, stable IDs, exact idempotent replay and account/thread match | Authenticated EXECUTE only; no direct INSERT/UPDATE grants |
| Server-only claim/finalize handlers | Claim before provider call; cost/rate guard; replay completed response; reject stale producer | Trusted server authenticated user context; no generic service-role writer exposed to model |

Naming is provisional until ALL-222 physical ownership approval. **Do not create these tables twice** if another workstream has already introduced the canonical Coach owner.

## Non-negotiable database and runtime invariants

1. **Owner/thread relation:** messages must have a composite thread-owner FK or equivalent enforced relationship; RLS `auth.uid()=user_id`; requests may never specify a different owner as authority. Profile-deletion cascades must cover threads, messages, claims, and any attached Coach metadata.
2. **Immutable messages:** no direct client UPDATE/INSERT. The authenticated owner can SELECT within their account; deletion through explicitly reviewed privacy/retention flow. A thread created by a different owner is rejected even if the UUID is known.
3. **Atomic pair:** an exchanged turn either commits **exactly** one user and one assistant row, or neither. Both are tied to one client request identity; reused IDs with different thread, role, owner, or content fail closed.
4. **Idempotent before model spend:** host issues a stable request UUID + fingerprint derived from exact authenticated owner, thread, normalized content and approved context identity; claim before provider invocation; completed retry returns saved canonical response, still-processing retry waits, conflicting request reuse rejects, abandoned claims have bounded leases and safe reclaim policy. Reclaim must not let an older execution overwrite a newer completion.
5. **Generated != saved:** the app may render an unsaved response with a visible warning and retry affordance, but it must not imply Coach will remember it. Do not advance to another turn while an exchange is unresolved unless the user explicitly discards it.
6. **Canonical readback:** after the append/finalize response, re-read the exact owner/thread/request/message IDs; validate both roles and contents. Only then report `saved_verified`. Reuse stable IDs for retry after ambiguous response/network loss; never blindly mint new IDs.
7. **Session switch:** client auth session generation and owner must still match after every network boundary. Wipe pending view state on owner changes; suppress stale replies even if a server write committed for the old owner. Stale pending local responses must not leak to a new account.
8. **Cost and rate safeguards:** count claims per user before model request; fail closed if policy unavailable; cap text, history and anchor retrieval, provider retries, model/tool usage, and generated response size. Do not expose provider secrets to mobile.
9. **No accidental durable authority:** conversation excerpts are `conversation_only`; accepted plans/restrictions and profile preferences come from fresh authenticated domain readers with source revision. Any Coach action still needs ALL-240 preview/approval/domain writer/readback.
10. **Audit, privacy, retention:** user-controlled deletion/export must include Coach history; no unconditional assistant messages containing private conditions in public analytics; no logging prompts to public telemetry; specify transcript window paging and eventual size/retention policy.

## Existing source already landed (not live)

- `apps/mobile-v2/src/features/coach/coachTurnContinuity.mjs` — bounded, same-account/thread older anchors, conversation-only authority.
- `coachTurnContext.mjs` — owner-certified history context, active restrictions, plan revision, expiry and per-sport coverage.
- `coachConversationLifecycle.mjs` — generated-versus-saved turn states, stable request ID, stale account/session rejection.
- `coachExchangePersistence.mjs` — injected atomic writer + independent canonical two-message readback before verified save; no database or RPC implementation yet.
- `npm run test:coach-quality` — dependency-free guard/fixture tests in the existing V2 Node smoke workflow.

## Verification plan and release gates

**Before any migration:** refresh latest V2 branch, ALL-222 physical ERD, applied V2 migration inventory and Supabase roles/permissions. Confirm exact proposed names and cascade ownership. Generate one migration + auth-owner read/write helper with restricted grants; do not use V1 table names or generic service-role mutable interface.

**Required isolated PostgreSQL tests:** anonymous SELECT/INSERT denied; user A cannot read, create, append, mutate, replay or delete B's thread; malformed/nonexistent thread blocked; two racing same-ID appends produce one exchange; conflicting same ID/payload aborts; one failed assistant insert rolls back the user row; replay under lease and stale reclaim cannot create duplicate responses; deletion cascades remove all user-owned data; operation fails without a valid JWT; no direct client table INSERT/UPDATE; pagination obeys account and thread filters.

**Required application tests:** authenticated session refresh, account switch during provider call, response generated but DB write failed, retry after lost RPC acknowledgment, cold restart, reopened thread, corrupted or partial read, different accepted plan revision, and no invented completion. Record exact Node/PG/Edge/device evidence separately in ALL-217 and ALL-241.

**Release:** no deployment, live model call, production/paid CI, or “persistent Coach is complete” claim from this proposal. Keep ALL-217/222/241 In Progress until owner RLS, actual DB reader/writer, authenticated two-user replay and installed-device behavior all pass.
