# V2 Training Workspace — Physical ERD & Security Proposal

**Status:** Proposed physical model for ALL-222 / ALL-246 owner review; NOT deployed or migration-approved  
**Domain owner:** ALL-246 — Training Workspace  
**Consumers:** ALL-231 Coach Training Intelligence; ALL-232 Athlete History; ALL-234 Race Strategy; ALL-239 Goals; ALL-240 Coach Action Manifest; ALL-243 Completed Activity; ALL-245 Watch/HealthKit/Equipment; ALL-250 Today; ALL-251 Profile/Availability/Training Locations; ALL-258 Exercise Library  
**Repository:** allinproject/All-In-V2  
**Branch:** integration/v2-foundation  
**Canonical backend:** Supabase project xarhuczrtzuiljmtdaeu  
**Reviewed:** 2026-11-10

> This is a physical-schema proposal for owner review, not a deployed ERD. No Training tables, RPCs, policies or migrations are created by this document. ALL-222 and ALL-246 must approve the aggregate boundaries, event identity, completion handoff and security contract before DDL.

## 1. Binding ownership and product contracts

1. Training owns the athlete-facing plan/calendar, accepted plan revision, stable planned-session identity, one canonical active session and its execution lifecycle.
2. Coach is a planner/proposer, not a Training writer. Coach can read Training facts and return a versioned proposal. Apply requires the explicit athlete decision and the Training-owned guarded writer.
3. A plan is not a completed workout. Preserve authored prescription, approved plan revision, execution events and completed evidence as distinct states and identities.
4. One athlete has at most one canonical active Training session at a time across phone, Watch and supported equipment. Devices attach observations to that same session; they do not create parallel sessions.
5. Training owns the execution envelope. Completed Activity (ALL-243) owns the canonical finished activity and sport-specific metric registry. Training must not create a second completed-activity/history store.
6. Athlete History (ALL-232) is a query/read-model consumer of canonical Training, Completed Activity, Strength, Race and Recovery records. It does not own a shadow timeline.
7. Goal identity, race identity/course evidence, exercise identity, training-location/equipment inventory, availability, device observations and personal Health data remain with their respective owners.
8. Missing data remains unknown. Planned targets, actual device measurements, manual corrections, inferred context and derived metrics remain distinguishable and carry provenance.
9. Local date/time is athlete-context data. A scheduled workout belongs to an athlete-local date and timezone; do not derive calendar placement by truncating UTC timestamps.
10. No plan is automatically rewritten because a session is missed. The deterministic lifecycle may create a review proposal; only an explicit accepted revision changes the future schedule.

## 2. Proposed physical ERD

The proposal separates plan identity, immutable plan revisions, stable scheduled-session slots, revision-specific session prescriptions, active execution, append-only execution events and private transactional handoff operations.

~~~mermaid
erDiagram
  auth_users ||--o{ v2_training_plans : owns
  v2_training_plans ||--o{ v2_training_plan_revisions : versions
  v2_training_plans ||--o{ v2_training_session_slots : defines
  v2_training_plan_revisions ||--o{ v2_training_revision_days : schedules
  v2_training_plan_revisions ||--o{ v2_training_revision_sessions : prescribes
  v2_training_session_slots ||--o{ v2_training_revision_sessions : stable_identity
  v2_training_revision_sessions ||--o| v2_training_session_instances : executes
  v2_training_session_instances ||--o{ v2_training_execution_events : records
  v2_training_plans ||--o{ private_v2_training_actions : idempotency
  v2_training_session_instances ||--o{ private_v2_training_outbox : completion_handoff
~~~

The private tables in the diagram are operational names, not approved final identifiers. They remain in allin_private and are not exposed through the Data API.

## 3. Table-by-table proposed contract

### 3.1 public.v2_training_plans — canonical plan aggregate

Proposed columns:
- id UUID primary key; user_id UUID not null references auth.users(id) on delete cascade.
- plan_kind TEXT not null: controlled values such as race, goal, general, maintenance, return-to-training or hybrid-event. Final vocabulary belongs to ALL-246/ALL-239.
- status TEXT not null: draft, active, paused, completed, archived.
- active_revision_id UUID null; version BIGINT not null; created_at and updated_at.
- Optional typed goal/race reference fields once the Goal/Race owners publish their canonical contracts. Do not create generic polymorphic entity references.

Constraints:
- Unique (id,user_id) to support same-owner composite foreign keys on children.
- A plan may have only one current active revision. The active revision must belong to the same plan.
- Plan owner cannot change. Soft archive is separate from deleting user data.
- The plan row is the serialization point for revision acceptance. A revision is never accepted by updating its child session rows in place.

### 3.2 public.v2_training_plan_revisions — immutable accepted prescription history

Proposed columns:
- id UUID primary key; plan_id UUID not null; user_id UUID not null.
- revision_number INTEGER not null; status TEXT not null: candidate, accepted, superseded, rejected, archived.
- source_kind TEXT not null: athlete-authored, Coach proposal, imported template or controlled system generation.
- source_ref TEXT null: typed source/proposal ID for provenance, not a permission grant.
- supersedes_revision_id UUID null; created_at, reviewed_at, accepted_at.
- Optional rationale_summary and change_summary fields bounded for display; canonical structured plan intent remains in revision children.

Constraints:
- Unique (plan_id,revision_number) and (id,plan_id,user_id).
- At most one accepted/current revision per plan. Enforce through the plan aggregate writer and a partial unique index where appropriate.
- Once accepted, the revision and all its revision-day/session content are immutable. A change creates a new revision; historical accepted work never changes retroactively.
- source_kind='coach_proposal' does not mean the revision is accepted. The separate proposal/apply flow binds exact proposal identity and expected plan revision.

### 3.3 public.v2_training_session_slots — stable logical planned-session identity

Proposed columns:
- id UUID primary key; plan_id UUID not null; user_id UUID not null.
- slot_key TEXT not null: stable plan-local logical key.
- status TEXT not null: active, retired.
- created_at and updated_at.

Rules:
- A slot identifies the logical scheduled workout across revisions. It is not a prescription snapshot and not an execution.
- The same slot can be moved or modified in a later revision while the prior revision-session row remains unchanged.
- A genuinely new workout gets a new slot; a removed workout retires the slot rather than reusing its ID for an unrelated workout.
- Unique (plan_id,slot_key) and same-owner composite FK to the plan.
- Completed Activity and session instances link to the exact revision-session identity, preserving what was actually prescribed when the session started.

### 3.4 public.v2_training_revision_days — explicit day state and phase

Proposed columns:
- id UUID primary key; plan_revision_id UUID not null; user_id UUID not null.
- athlete_local_date DATE not null; day_state TEXT not null: planned, rest, recovery, unavailable, race, review_required.
- phase_key TEXT null; sort_order INTEGER not null.
- Optional day-note/summary fields only if the workspace needs athlete-authored plan annotations.

Rules:
- Unique (plan_revision_id,athlete_local_date).
- race occurs only on the exact canonical race date supplied by the Race/Goal owner; do not infer it from a label.
- An empty day is not silently interpreted as confirmed rest. rest, recovery, unavailable and review_required are explicit, distinct states.
- User availability/preferences remain owned by Profile/Availability. A plan revision stores the reviewed scheduled result, not a second availability source of truth.
- Athlete-local date is a date, not a UTC timestamp. The plan revision also records the timezone used to interpret scheduled times.

### 3.5 public.v2_training_revision_sessions — versioned session intent

Proposed columns:
- id UUID primary key; plan_revision_id UUID not null; session_slot_id UUID not null; user_id UUID not null.
- athlete_local_date DATE not null; optional local_start_time TIME; timezone TEXT not null.
- sport TEXT not null: running, cycling, swimming, strength, hiking, rucking, rowing, elliptical, stair, yoga, mobility, other. Extend only with domain review.
- session_kind TEXT not null; purpose TEXT not null; priority TEXT not null (competition/key/supporting/optional); intensity TEXT not null (easy/moderate/hard/unknown).
- duration_target_seconds INTEGER null; optional explicitly typed target quantities/units where the session contract defines them.
- intent_schema_version TEXT not null; intent JSONB not null; sort_order INTEGER not null.
- Source/evidence references and created timestamp.

Rules:
- Composite FK (session_slot_id,plan_id,user_id) and (plan_revision_id,plan_id,user_id) so a revision cannot attach a slot from another plan or athlete.
- Unique (plan_revision_id,session_slot_id) prevents duplicate scheduled copies of the same stable slot inside one revision.
- intent_schema_version is mandatory. The owning writer accepts only registered, validated versions; no arbitrary model-generated JSON is persisted as canonical plan intent.
- The versioned intent contract represents sport-specific purpose, targets, demand/stress dimensions and structured content. Strength structures retain block/round/exercise/set identity and reference ALL-258 exercise IDs. Swim sets preserve stroke, pool length/unit, send-off versus fixed-rest timing, drill/kick/manual-credit intent and equipment. Multisport/brick intent contains explicit ordered legs and transitions; it is one planned session, not unrelated sessions inferred to be adjacent.
- Missing pace, FTP, CSS, machine level, load, distance, power or other prescription remains unknown. Do not fabricate numeric targets to fill a schema.
- No per-plan macro/nutrition fields, exercise catalog duplicates, route geometry blobs or provider metric history belong here.

### 3.6 public.v2_training_session_instances — canonical execution envelope

Proposed columns:
- id UUID primary key; user_id UUID not null; revision_session_id UUID null.
- status TEXT not null: active, paused, finishing, completed, cancelled, abandoned, skipped. Final terminal-state rules require ALL-246 review.
- source_kind TEXT not null: phone, watch, supported_equipment, manual or import_handoff.
- started_at TIMESTAMPTZ null; finished_at TIMESTAMPTZ null; athlete_local_date DATE not null; timezone TEXT not null.
- version BIGINT not null; last_event_sequence BIGINT not null; created_at and updated_at.
- completion_activity_id UUID null is a typed reference to ALL-243's canonical activity ID only after that owner approves the shared link contract. Do not create a second activity row in Training.

Constraints:
- At most one active/paused/finishing session per user via a partial unique index on user_id. This is the database backstop for phone/Watch/equipment concurrency.
- A revision session can have at most one canonical execution instance unless ALL-246 explicitly approves a repeat-session identity model. Repeating a stage inside one workout is not creating another workout.
- Instance binds the exact accepted plan revision/session at start. A plan update during execution must not silently rewrite the running prescription.
- Manual/imported Completed Activity does not need a fake active-session lifecycle; ALL-243 owns those records and may link them to a planned revision session when the source proves the relationship.
- Actual sport metrics, route samples, laps/splits, HR/power streams, strength set results and multisport completion measurements live in ALL-243 or source-owned observation contracts, not in this envelope.

### 3.7 public.v2_training_execution_events — append-only execution truth

Proposed columns:
- id UUID primary key; session_instance_id UUID not null; user_id UUID not null.
- sequence_number BIGINT not null; event_type TEXT not null; source_kind TEXT not null.
- occurred_at TIMESTAMPTZ not null; recorded_at TIMESTAMPTZ not null.
- event_schema_version TEXT not null; event_payload JSONB not null.
- Optional trusted device/source reference and payload hash.

Event types include start, pause, resume, lap, stage advance/back, repeat, target/mode change, source connected/disconnected/reconnected, manual correction, finish requested, completion committed and cancel. Use a finite allowlist; do not accept arbitrary event strings.

Rules:
- Unique (session_instance_id,sequence_number) and unique source/action identity for exact retry.
- Events are append-only. A correction adds a correction event; it does not rewrite the original event.
- occurred_at is device/source event time; recorded_at is server receipt time. Keep both to reason about offline uploads and clock skew.
- Event payload is bounded and schema-versioned. Large GPS/HR/power streams are not embedded in JSON events.
- Event ingestion checks p_expected_user_id=auth.uid(), current session owner, event sequence, expected session version and client action ID. Stale or duplicate conflicting events fail closed.
- The event stream records execution changes, not the complete sensor dataset. Source observations are reconciled to ALL-243/ALL-245 contracts.

### 3.8 Private idempotency ledger and completion outbox

Proposed allin_private.v2_training_actions:
- (user_id,client_action_id) composite primary key; aggregate kind/id; action type; payload hash; expected/result versions; result reference; created time.
- Exact retry with identical actor/action/payload returns the original result. Reuse of an action ID with different payload fails. No user-supplied owner can override auth.uid().
- Used by plan accept/revise, session start, execution events, finish and cancel commands. Keep it private and unavailable via direct Data API.

Proposed allin_private.v2_training_outbox:
- Immutable event ID; session instance ID; event type; bounded payload; delivery state/attempt metadata; created/processed timestamps.
- A successful Training finish writes the terminal execution event and a completion-handoff outbox row in the same transaction.
- ALL-243's activity writer consumes the handoff idempotently, keyed by the exact Training session instance/source reference. It creates one canonical Completed Activity and returns/records the activity ID. Retries cannot duplicate the activity.
- The outbox is a transactional cross-domain delivery mechanism, not a new user-facing history store. A service/owner worker claims and acknowledges rows through narrow functions; neither athletes nor generic Coach tools get outbox access.
- The exact retry/reconciliation worker and whether it is synchronous or asynchronous must be approved with ALL-243 before DDL. Do not promise instant completion detail before the activity owner commits it.

## 4. Cross-domain ownership and no-duplicate rules

| Concern | Canonical owner | Training relationship |
|---|---|---|
| User identity, timezone/preferences, availability and named Training Locations/equipment | Auth/Profile — ALL-251 | Read current values; snapshot only the reviewed schedule/timezone needed for a plan revision. No duplicate equipment inventory. |
| Goal identities and non-race goals | Goals — ALL-239 | Typed goal reference; no goal CRUD or copied progress records. |
| Race identity, route/course, surface, elevation and aid stations | Race/Route — ALL-234 | Typed race reference; plan uses verified course evidence/version. No route-source duplication. |
| Coach plan reasoning/proposal | Coach — ALL-231 / Apply manifest ALL-240 | Coach reads constraints and proposes. Training validates and accepts the selected plan revision. |
| Exercise and movement identity, variations, equipment requirements | Exercise Library — ALL-258 | Reference canonical exercise IDs in approved strength structures; no duplicate exercise catalog. |
| Active-session device observations and HealthKit permissions | Devices — ALL-245 | Same session instance ID; source observations retain device/source provenance and partial coverage. |
| Canonical completed metrics, details, maps, splits, series and analysis | Completed Activity — ALL-243 | Training emits one completion handoff tied to exact plan/session identities. No duplicate completed activity or metric registry. |
| Longitudinal query/read model and coverage windows | Athlete History — ALL-232 | Query Training/Activity/Strength/Recovery owners. No shadow history table or embeddings-only timeline. |
| Today cards and daily navigation | Today — ALL-250 | Read accepted plan day/session and current active session. No second calendar store. |

## 5. Proposed read/write and security matrix

All plan/session data is user-private and belongs to one authenticated athlete.

| Object | RLS | Authenticated direct access | Canonical writer |
|---|---|---|---|
| public.v2_training_plans | Enabled; owner SELECT | SELECT own rows only | Plan create/archive/accept RPCs |
| public.v2_training_plan_revisions | Enabled; owner SELECT | SELECT own rows only | Revision build/accept/reject RPCs; accepted content immutable |
| public.v2_training_session_slots | Enabled; owner SELECT | SELECT own rows only | Owning plan-revision writer |
| public.v2_training_revision_days | Enabled; owner SELECT | SELECT own rows only | Owning plan-revision writer |
| public.v2_training_revision_sessions | Enabled; owner SELECT | SELECT own rows only | Owning plan-revision writer |
| public.v2_training_session_instances | Enabled; owner SELECT | SELECT own rows only | Start/pause/resume/finish/cancel RPCs |
| public.v2_training_execution_events | Enabled; owner SELECT | SELECT own rows only | Append-only event-ingest RPC |
| allin_private.v2_training_actions | Enabled; no policies | No schema/table access | Narrow owner RPCs only |
| allin_private.v2_training_outbox | Enabled; no policies | No schema/table access | Training finish writer and private delivery worker |

Security rules:
- Explicit grants only. No anon access and no blanket client INSERT/UPDATE/DELETE on canonical Training data.
- Every user-scoped mutation includes p_expected_user_id; PostgreSQL compares it to auth.uid() before any mutation or idempotency lookup. Follow the current foundation's migration-005 expected-owner guard.
- Use expected plan version/revision and session version for compare-and-swap. Concurrent stale writes fail; never last-write-wins a newer revision or active session.
- Use per-user/aggregate serialization where two commands could create overlapping active sessions, accept two revisions or finish the same session concurrently.
- If SECURITY DEFINER is required, keep owner postgres, search_path='', fully qualify every object, revoke EXECUTE from PUBLIC/anon, grant only the exact authenticated API role, and validate expected owner/permissions inside the function. Document intentional advisor WARNs. Private helpers stay outside exposed schemas and are not client-callable.
- Private action/outbox ledgers have RLS enabled, no policies and no direct grants to anon/authenticated/service_role. Do not add a permissive policy to suppress the INFO advisory.
- Coach is not granted generic Training write RPC access. Apply invokes the same narrowly scoped Training operation as the Training UI after user approval.
- Device source identity is not a grant. Watch/equipment ingestion must use a server-validated link to the active session and authorized user/device, with unique source event IDs and stale-account/session rejection.
- Data export/deletion remains coordinated with ALL-251; deleting an account cascades owner-scoped Training rows and purges private per-user action metadata under reviewed retention policy.

## 6. Required database operations / event contracts

Only the following operation families are proposed for the first Training data slice:

1. Create a draft plan and first revision.
2. Add/update candidate revision content, then validate all session/phase/day/goal constraints.
3. Accept a revision only with expected plan version/revision and exact approval action ID; atomically switch the active revision.
4. Mark a plan archived/paused without rewriting prior revisions.
5. Start a session only if no other active/paused/finishing session exists for the athlete, bind exact revision-session and expected plan revision, and return stable session ID.
6. Append event batch with monotonic sequence, exact retry semantics and source provenance.
7. Pause/resume using expected session version; reject terminal sessions.
8. Finish once, persist terminal event plus outbox in one transaction, then let ALL-243 create/reconcile the canonical completed record idempotently.
9. Cancel or mark skipped with explicit reason; never convert a cancelled/skipped session to completed through a retry.
10. Read current plan/calendar/active-session state with source revision/version and timezone semantics for the client/Coach.

The first vertical slice should not include a full scheduling optimizer, workout recommendation engine, device transport implementation, metrics registry, Exercise catalog, Availability database or Goal/Race CRUD. Those stay with their owners.

## 7. Migration and implementation sequence after approval

1. ALL-222 and ALL-246 finalize stable slot/revision semantics, day-state vocabulary, plan-kind/status values and the first session-intent schema version.
2. ALL-243 approves the transactional completion handoff/outbox identity and its idempotent Completed Activity writer. ALL-245 approves device/source event identity and account-switch/offline semantics.
3. ALL-251 approves timezone/profile/availability reference semantics, named Training Location ownership, retention/export/deletion interaction and any account-lifecycle edge cases.
4. Author a small migration for plan/revision/slot/day/revision-session reads with RLS/grants and exact composite owner FKs.
5. Add narrow plan create/accept/archive RPCs with expected owner/version/action key and two-user isolation tests.
6. Add active-session/event tables and one-session-per-user partial unique index; implement start/pause/resume/cancel/finish with rollback-only concurrency and exact-retry tests.
7. Add the private completion outbox plus ALL-243 consumer only after the cross-domain transaction/retry contract is approved.
8. Regenerate public database types from live schema, prove equality, add owner read adapters for ALL-232/ALL-250, then run clean migration reset/replay, npm/typecheck/test/Expo and installed-device gates under ALL-224/ALL-245.

No migration should create Completed Activity tables, provider raw telemetry tables, HealthKit payload tables, exercise library tables, Pantry/Meal Prep tables, user availability tables or Coach conversation/proposal tables under the Training schema.

## 8. Required acceptance tests before this model becomes deployable

- Two athletes cannot read, update, start or finish each other's plans/sessions/events.
- An expected-user mismatch fails 42501 even if the client switches accounts after local session check.
- Stale plan version/revision and stale session version fail without overwriting newer state.
- Exact action retry returns the original result; same action ID with changed payload fails.
- Two concurrent start commands from phone and Watch create one active session only.
- Two concurrent finish commands create one terminal Training session and one Completed Activity handoff.
- A session start binds exact plan revision; a later accepted revision does not mutate the live session.
- A missed workout is not copied to the next day and does not add completed load.
- Athlete-local calendar days remain correct across UTC midnight, DST boundaries, travel/timezone changes and weekly/monthly boundaries.
- Accepted revision preserves rest/recovery/unavailable/race/review-required day distinctions.
- Multisport plan is one session with explicit ordered legs/transitions; no session is inferred to be a brick from adjacency.
- Swim sends send_off and fixed_rest as distinct timing modes, preserves yards/meters and keeps manual drill/kick credit separate from sensor-measured distance.
- Elliptical and stair-stepper are distinct sports; unknown device metrics remain absent.
- Strength structures preserve approved block/round/exercise/role/set identity; ALL-258 exercise IDs are referenced rather than copied.
- Watch/equipment retries, offline delayed events, duplicate source events, process death and account switch cannot create phantom sessions or phantom completion.
- Outbox retry/replay cannot duplicate Completed Activity; pending delivery is visible as a reconciliation state, not falsely reported as a completed metric record.
- History reader reports coverage gaps and source provenance; it never claims a complete training history from partial device sync.
- Canonical Training data is not duplicated in Coach memory, Today cache, Progress snapshots, Watch storage or a second history table.

## 9. Owner decisions required before DDL

1. Final plan-kind/status lifecycle and whether non-race/general plans share one aggregate.
2. Stable session_slot_id behavior when a workout is moved, substituted, removed or reintroduced in a later revision.
3. Whether revision content is immutable after review or candidate revisions can be edited before acceptance; exact revision numbering and supersession.
4. First registered session-intent schema version and how versioned JSON is validated at the trusted writer.
5. Exact athlete-local timezone behavior when a plan spans travel/DST and the athlete changes profile timezone.
6. Session instance cardinality: one canonical execution per revision-session or explicit repeat-instance model.
7. Which states count toward the single-active-session constraint (active, paused, finishing) and abandoned-session recovery policy.
8. The transactional outbox vs synchronous cross-domain completion call with ALL-243; expected offline finish and reconciliation UX.
9. Source-event identity/sequence and device authorization with ALL-245.
10. Goal/race reference contracts with ALL-239/ALL-234 and profile/availability reference semantics with ALL-251.
11. Retention for raw execution events/action hashes/outbox payloads, including account export/deletion.
12. Whether multi-sport leg/transition identity belongs in versioned session intent or a dedicated normalized child table in the first slice.

Until the owners resolve these points, do not create Training DDL or claim Training Workspace persistence is implemented.


## 10. Calendar read-boundary acceptance proposal — 2026-11-10

**Status: proposal for ALL-222/246 and ALL-243 owner decision; no DDL, RPC, grant, or deployment is authorized by this section.**

Live inspection of the canonical V2 project `xarhuczrtzuiljmtdaeu` on 2026-11-10 found only V2 Profile, Profile Settings, Onboarding, Legal and private provider-cache/action tables. **No V2 Training or Completed Activity tables are deployed**. Applied migrations end at `20261110124420_v2_provider_cache_cron_schedule`. Do not wire a fake `v2_training_*` SQL read or treat zero returned records from a nonexistent source as a verified empty plan.

### One owner-scoped calendar window, two authoritative reads

For an authenticated athlete and an explicit athlete-local date window `[fromDate, throughDate]`:

1. **Training owner (ALL-246)** returns only the latest accepted revision's effective planned-session slots/day states that apply within the requested date window, with immutable `plannedSessionId`, `athleteLocalDate`, `sport`, exact `state` (`planned`/`missed`/`rest`/`recovery`/`cancelled`), `acceptedPlanRevisionId`, and source/version/freshness. `cancelled` is preserved as source evidence but excluded from visible scheduled-workout cards. Multiple plans must not create ambiguous active authority; owner must define plan selection/precedence before certification.
2. **Completed Activity owner (ALL-243)** returns one canonical activity per finished workout in the same window, with `completedActivityId`, `athleteLocalDate`, `sport`, `sourceKind`, nullable confirmed `plannedSessionId`, source identity and freshness/coverage. Duplicate device/provider reports reconcile to one activity *before* being considered ready; unresolved duplicates or source conflicts are **not** a verified complete read.
3. **Both reads independently attest** the authenticated owner, requested date boundaries, snapshot revision/time, completeness of their own scope and no unresolved pagination. The client may display one source while the other is unavailable, but **month markers requiring a combined planned/completed view remain unavailable** until both are complete and mutually consistent. Zero records is only a known-empty result after full read certification; absent records, timeout, stale account, rejected pagination, or unsupported owner scope are *unknown*, not rest or missed days.
4. Both owners must agree on **athlete-local timezone/date rules** rather than deriving date from UTC midnight. The Week request covers Monday–Sunday, and Month covers all visible 5/6 calendar-grid weeks including spillover dates. Both are derived by the existing `visibleCalendarReadRange` helper. Requests outside the attested window must never display verified emptiness.
5. The read models and Coach stay **read-only**. A matching same-day Completed Activity can suppress the corresponding *planned* card in the display only; this never revises the Training plan. A different-sport link, duplicate linked activity, link to missed/rest/recovery/cancelled, or cross-day completion does **not** silently convert the accepted schedule. Source owner reconciliation must resolve conflicts before any merged ready-state claim.
6. **Security:** all source objects must be owner-isolated with RLS/least-privilege SELECT, no anon access and no cross-owner inference; no client service-role key. A client `ownerId` is context, not proof of authorization. Reauthentication/account-switch invalidates outstanding window reads and cached UI state; each certified client snapshot must retain the **authentication session generation at fetch initiation**, and the current session generation must match at read presentation even if the same athlete logs in again. Exact screen navigations must carry source IDs and date; item actions validate current owner/version server-side.

### Required implementation/verification gate

* First resolve Sections 9 owner decisions for stable planned-session IDs, accepted-revision precedence, day statuses, timezone behavior and Completed Activity handoff/linking; adopt the minimal first-slice schema only through reviewed versioned migrations and two-account RLS checks.
* Add a single Training-owner read adapter and a single Completed Activity-owner read adapter, each returning a verified complete-scope result compatible with existing `OwnerCalendarRead` and `combineCalendarReads`; avoid another calendar table or client-side inferred source.
* Verify empty week, two scheduled sessions, multi-sport day, unrelated manually logged activity, same-day linked completion, moved/cross-day completion, duplicate/mismatched links, missed/rest/recovery/cancelled, stale revision, partial pagination, month-grid spillover, DST/timezone, cross-owner visibility and mid-fetch sign-out.
* Only then connect live readers to `apps/mobile-v2/app/train.tsx`, remove the current explicit unavailable adapters, and run automated, database/RLS, Expo and device acceptance with ALL-224/254. **No implementation completion claim until those checks actually pass.**


## 11. Minimal Training read-only migration review slice — 2026-11-10

**Review-only design; NO migration, runtime schema or RLS change is authorized.** This is a constrained subset of the existing Sections 3, 5, 7 and 10, not a new owner or source of truth. V2 project `xarhuczrtzuiljmtdaeu` still has no Training or Completed Activity tables.

### Minimal owning tables, in dependency order

1. `public.v2_training_plans`: immutable `id`, `user_id`, plan `status`, `active_revision_id`, monotonic `version`; `unique(id,user_id)`. Only authenticated plan owner reads.
2. `public.v2_training_plan_revisions`: immutable `id`, `plan_id`, `user_id`, `revision_number`, explicit `status`, reviewed `accepted_at`; `unique(id,plan_id,user_id)`, `unique(plan_id,revision_number)`, composite same-owner plan FK. Plan's `active_revision_id` must reference this plan's own revision after approval, never an arbitrary revision.
3. `public.v2_training_session_slots`: stable `id`, `plan_id`, `user_id`, `slot_key`, `status`; composite same-owner FK to plan and `unique(plan_id,slot_key)`. Stable identity across reschedules; no slot re-use for unrelated activities.
4. `public.v2_training_revision_days`: explicit `plan_revision_id`, `user_id`, `athlete_local_date DATE`, `day_state`, `sort_order`; same-owner revision FK and `unique(plan_revision_id,athlete_local_date)`. Preserve `rest`, `recovery`, `unavailable`, `race` and `review_required` separately. This source is not a finished workout.
5. `public.v2_training_revision_sessions`: immutable `id`, `plan_revision_id`, `session_slot_id`, `user_id`, `athlete_local_date DATE`, `timezone`, `sport`, `sort_order`, registered `intent_schema_version` and validated versioned intent, with same-plan/same-owner revision and slot FKs. Only the revision linked through the plan's active revision contributes to the **current** calendar. Finished activities do not live here.

Do **not** include active-session telemetry, raw GPS, metric registry, Completed Activity rows, or Coach proposal stores in this first migration. Their owners retain their later slices. If required stable ID semantics or planned/rest mapping differ from Section 3, resolve them **before** writing the migration.

### Migration and runtime invariants to review

- All five public tables must have RLS enabled, explicit least-privilege `SELECT` to `authenticated`, policies binding `user_id = (select auth.uid())`, and **no** `anon` access. Do not grant general client write access; source mutations require the later reviewed Training owner writer.
- Composite FKs guarantee plan, revision, slot and day all belong to the **same user**. Validate the active-revision backreference after creating both dependent tables. Enforce only one authoritative accepted/current revision per plan; a candidate or superseded revision must not leak into calendar reads.
- Return an owner-attested **complete date-window snapshot**, not a client-gathered partial join. The certified snapshot must explicitly identify plan/current revision(s), athlete timezone, first/last covered athlete-local dates, source version, unconsumed cursor (null only on completion), and the auth session generation at fetch start. The existing `certifyCalendarOwnerRead` is a **client guard**, not a replacement for RLS, server scope enforcement or snapshot consistency.
- The calendar's `PlannedCalendarItem.state` (`planned/missed/rest/recovery/cancelled`) and the proposed `revision_days.day_state` (`planned/rest/recovery/unavailable/race/review_required`) are **not the same vocabulary**. Never pretend `unavailable`, `race` or `review_required` are completed/missed workouts. Owner must publish a typed translation/expansion contract (or widen the presenter state) before connecting real reads. In particular `missed` and `cancelled` require explicit lifecycle evidence, not a past date or missing record.
- A read-only Training schema **cannot** make the full calendar ready while ALL-243 Completed Activity remains absent. Show planned data as partial; combined month completed indicators stay unavailable. No fake completed data, no manual-entry success claim, and no permanent duplicate read store.

### Required evidence before approval/deployment

1. Owner decision record on stable slot identity, revision immutability/acceptance semantics, timezone/travel policy, `day_state` translation, plan-current precedence and exact completion link.
2. A versioned migration generated by the existing repository/CLI workflow, reviewed for schema ownership, grants, FK consistency and transactional safety; no invented migration filenames.
3. Clean replay of existing seven V2 migrations plus the proposed slice in an isolated database; two-user, unauthenticated and wrong-owner SELECT/INSERT/UPDATE/DELETE denial checks; current/superseded revision checks.
4. Owner-scoped empty and populated date-window read checks including multiple sports/day, explicit rest/recovery, month spillover and timezone; paginated/partial fetch must refuse `ready`.
5. Only after ALL-243's canonical Completed Activity read contract is approved and available should `app/train.tsx` replace its explicit unavailable source with live reads. Then execute registered Training tests, TypeScript/Expo/device checks, with evidence in ALL-224 and founder acceptance in ALL-254.

**Status:** candidate review slice only. Do not mark ALL-222, ALL-243 or ALL-246 complete from this document.
