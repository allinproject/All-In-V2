# V2 Goals — Physical ERD & Security Proposal

**Status:** Proposed physical model for ALL-222 / ALL-239 owner review; NOT deployed or migration-approved  
**Domain owner:** ALL-239 — Goal Planning Beyond Races  
**Consumers:** ALL-246 Training; ALL-231 Coach; ALL-232 Athlete History; ALL-243 Completed Activity; ALL-249 Progress; ALL-234 Race Strategy; ALL-258 Exercise Library; ALL-257 Strength History Import; ALL-240 Coach Action Manifest  
**Repository:** allinproject/All-In-V2  
**Branch:** integration/v2-foundation  
**Canonical backend:** Supabase project xarhuczrtzuiljmtdaeu  
**Reviewed:** 2026-11-10

> This is a physical-schema proposal for owner review, not a deployed ERD. No Goals tables, metric definitions, RPCs, policies or migrations are created by this document. ALL-222 and ALL-239 must approve the aggregate boundaries, goal-measure contract, evidence links and Training/Progress handoff before DDL.

## 1. Binding ownership and product contracts

1. Goals owns the athlete's explicit outcome or intention: what they want to change, why it matters, optional target window, optional measurable baseline/target, priority and evidence requirements. A valid goal may begin as a qualitative intention with no baseline, numeric metric or deadline.
2. Goals does not own training plans, workout calendars, planned sessions, completed activities, exercise definitions, race/course records, PRs, badges, milestone totals or Coach conversations.
3. Training (ALL-246) consumes an accepted goal revision to create a reviewable plan. It owns plan/session dates, progression, daily structure and acceptance. Goal changes do not silently rewrite an accepted Training revision.
4. Completed Activity (ALL-243) owns measured activity facts and the versioned metric registry. Goals references a metric definition/version for outcome measures; it does not recreate sport metric definitions or source facts.
5. Race identity/course and official race/result evidence remain with Race/Route (ALL-234) and Completed Activity (ALL-243). Goals stores a typed reference, not copied route/course facts.
6. Exercise identity and movement variants remain with Exercise Library (ALL-258). A strength goal references an exact canonical exercise ID; it does not invent a new exercise label or treat a generic workout as a verified lift result.
7. Progress (ALL-249) owns the user-facing progress, PR, Badge and Milestone projections. It reads Goals, Training and Completed Activity; it does not create a second goal, workout or result database.
8. Every goal is sport-/measure-specific. Do not collapse running distance, cycling distance, swim pace, machine steps/floors, lifting load/reps, consistency and general capacity into one universal score or interchangeable unit.
9. A goal may be an active qualitative intention or behavior goal without a reliable baseline, numeric target or deadline. It can still receive small, user-approved next steps. Never force a numeric target or deadline and never silently assign a 1RM, FTP, stair count, pack weight, pace, course distance, calories or body weight.
10. Baseline, target, actual evidence and prediction are distinct: a user-entered baseline is not measured device evidence; a prediction is not a completed result; a goal being scheduled is not a goal being achieved.

## 2. Proposed physical ERD

The proposal separates stable goal identity, immutable goal revisions, typed measure targets, goal relationships and evidence references. Progress is derived from canonical evidence through ALL-249; this model does not persist a duplicate progress history.

~~~mermaid
erDiagram
  auth_users ||--o{ v2_goals : owns
  v2_goals ||--o{ v2_goal_revisions : versions
  v2_goal_revisions ||--o{ v2_goal_revision_measures : optionally_defines
  v2_goal_revisions ||--o{ v2_goal_revision_behavior_targets : optionally_defines
  v2_goals ||--o{ v2_goal_relationships : relates
  v2_goal_revisions ||--o{ v2_goal_measure_evidence : supports
  v2_goal_revision_measures ||--o{ v2_goal_measure_evidence : evidence_for
  v2_goal_measure_evidence ||--o| v2_goal_activity_evidence : completed_activity
  v2_goal_measure_evidence ||--o| v2_goal_manual_evidence : user_reported
  v2_goal_measure_evidence ||--o| v2_goal_race_evidence : race_result
  v2_goals ||--o{ private_v2_goal_actions : idempotency

  v2_goals {
    uuid id PK
    uuid user_id FK
    text goal_kind
    text title
    text status
    bigint version
    timestamptz created_at
    timestamptz updated_at
  }
  v2_goal_revisions {
    uuid id PK
    uuid goal_id FK
    uuid user_id FK
    integer revision_number
    text status
    text priority_role
    integer priority_order "nullable; ties permitted; no unique-primary constraint"
    date start_date "nullable"
    date target_date "nullable"
    date check_in_date "nullable"
    text goal_schema_version
    timestamptz accepted_at
  }
  v2_goal_revision_behavior_targets {
    uuid id PK
    uuid goal_revision_id FK
    text behavior_code
    text behavior_description
    text cadence_kind
    numeric target_frequency
    text frequency_period
    boolean user_confirmed
  }
  v2_goal_revision_measures {
    uuid id PK
    uuid goal_revision_id FK
    text metric_code
    integer metric_definition_version
    text target_operator
    numeric baseline_value
    numeric target_value
    text baseline_kind
    timestamptz baseline_at
  }
  v2_goal_relationships {
    uuid id PK
    uuid goal_id FK
    uuid related_goal_id FK
    text relation_kind
    date effective_from
    date effective_to
  }
  v2_goal_measure_evidence {
    uuid id PK
    uuid goal_revision_measure_id FK
    text evidence_kind
    text review_status
    timestamptz occurred_at
    timestamptz recorded_at
  }
  v2_goal_activity_evidence {
    uuid evidence_id PK,FK
    uuid activity_id FK
    uuid metric_value_id FK
  }
  v2_goal_manual_evidence {
    uuid evidence_id PK,FK
    text value_text
    numeric value_numeric
    text unit
    boolean confirmed_by_user
  }
  v2_goal_race_evidence {
    uuid evidence_id PK,FK
    uuid race_id FK
    text result_status
  }
  private_v2_goal_actions {
    uuid user_id FK
    text client_action_id
    uuid goal_id FK
    text payload_sha256
    bigint result_version
  }
~~~

The evidence child tables are a proposed typed relationship pattern. Their final identifiers and foreign keys depend on the canonical ALL-243 activity schema and ALL-234 race/result schema. They are not authorization to add polymorphic, unchecked source references.

## Review-only first physical identity slice (2026-11-11)

The existing Goals owner now has a narrow proposed SQL file:
`docs/architecture/sql/V2-GOALS-IDENTITY-REVISION-OWNER-CANDIDATE.sql`.
It models stable owner-bound `public.v2_goals`, immutable-intent revision
identities in `public.v2_goal_revisions`, same-goal composite active-revision
FK, an at-most-one-current-accepted-revision index **per goal**, and private-by-default
RLS/REVOKE. Multiple simultaneous primary goals and undated qualitative goals
are intentionally valid. A rollback-only local Supabase smoke fixture lives at
`scripts/test-v2-goals-owner-local-postgres.psql` and is included in the
existing V2 local-foundation workflow.

**This is not a deployed or owner-approved migration.** The follow-on
`V2-GOALS-REVISION-HISTORY-GUARD-CANDIDATE.sql` adds a SQL trigger rejecting
in-place updates or direct deletion of published Goal revisions while the
account exists, while allowing exact accepted→superseded status and genuine
Auth account teardown cascades. The rollback-only test additionally covers
rejection of revision mutations, supersession and two-owner deletion isolation.
The proposed SQL still has no approved client/Coach acceptance writer,
no Goal metric/behavior/typed Event evidence child tables, and no Training FK
to an unavailable authoritative Event owner. Those remain dependent on ALL-239,
ALL-243, ALL-244 and ALL-222 review. A passing SQL replay demonstrates only
the stated identities, ownership constraints, role isolation and replayability.

## Review-only Goal approval and owner-reader candidates (2026-11-11)

All work is **candidate-only, not deployed or migration-approved**. The
existing canonical Goal identity and revision tables remain the single owner.

The `V2-GOALS-REVISION-ACCEPTANCE-WRITER-CANDIDATE.sql` now creates
`allin_private.v2_goal_accept_revision_candidate` in the **private schema**,
not an exposed public RPC. It holds a live `auth.sessions` row lock through
the acceptance transaction and binds both the acceptance request and durable
idempotent action receipt to the exact verified athlete/session. Expired,
revoked or foreign sessions are denied before replay; session revocation does
not remove the historical action receipt. The writer serializes on Goal
identity, checks expected version, preserves accepted history and refuses
changed action fingerprints. There is **no grant to service_role, anon or
authenticated** and no hosted gateway.

[Local Supabase CI 43143017750](https://github.com/allinproject/All-In-V2/actions/runs/43143017750)
**passed** the session-bound owner/retry and two-connection lock race.
The earlier [43140792513](https://github.com/allinproject/All-In-V2/actions/runs/43140792513)
passed the original CAS concurrency test.

The owner snapshot proposal is
`V2-GOALS-OWNER-SNAPSHOT-READER-CANDIDATE.sql`, a private bounded read
over canonical Goals and currently accepted revisions. It checks
`auth.uid()`, exact expected owner, active `auth.sessions`, existing V2
profile and complete bounded coverage; no client access, cross-user rows or
unverified EventHub/Training facts. The rollback-only test also verifies that
revoked sessions cannot continue reading. Local Supabase
[43142378420](https://github.com/allinproject/All-In-V2/actions/runs/43142378420)
passed this reader after correcting the fixture to reuse automatic signup
profiles.

`supabase/functions/_shared/goalAcceptanceAuthServices.mjs` stages a
**default-off, source-only trusted server adapter**. Its independently tested
contract rejects client-supplied owner IDs, session IDs and fingerprints,
requires a currently verified signed-in athlete, and expects a canonical,
fresh, exact, server-approved preview receipt before the private transactional
writer can be invoked. It is not a deployed Edge Function. The real private
preview authorization gateway remains unbuilt and must verify consent,
Auth session, version, rate limits and cancellation within the trusted
transaction before any production grant is considered.

## Review-only Goal behavior children (2026-11-11)

`V2-GOALS-BEHAVIOR-TARGET-OWNER-CANDIDATE.sql` adds only optional
`v2_goal_revision_behavior_targets` children of the **same** canonical
Goal revision, never a separate habits database. It preserves undated,
qualitative, unmeasured intentions, optional cadence and existing Training/
Food Log/Meal Prep evidence ownership. Composite owner/revision FKs,
RLS and revoked client privileges enforce isolation; historical published
behavior targets cannot be changed in place or supplemented afterwards.

A Goal revision carrying behavior children may transition to accepted only
after **all included behaviors are explicitly athlete-confirmed**. An
unconfirmed Coach-suggested habit remains a candidate, not silently adopted.
The standalone rollback-only behavior/approval tests are tracked under
`scripts/test-v2-goals-behavior-local-postgres.psql` and the existing local
Supabase replay workflow. The candidate still lacks final behavior source
proof and published app UI acceptance, so it is not deployable.

## Durable reviewed Goal acceptance candidate (2026-11-12)

The **same canonical Goals owner** now has an additional review-only
`docs/architecture/sql/V2-GOALS-DURABLE-REVIEW-GATE-CANDIDATE.sql`.
It introduces an internal `allin_private.v2_goal_approval_reviews` record for
the *exact* athlete, Auth session, Goal, candidate revision, action UUID,
expected version, reviewed payload SHA-256, explicit athlete confirmation,
review time, and strictly bounded expiration. It does **not** create another
Goal, Training plan, calendar, habit engine, EventHub registry or consent UI.

The private `v2_goal_commit_reviewed_candidate` gateway locks the current
Auth session and reviewed record, checks exact match and time bounds, then
invokes the existing canonical revision writer **in the same transaction**.
Exact retries return the existing action receipt; changed fingerprints,
cross-account sessions, expired reviews and revoked sessions fail closed.
The completed review and idempotent acceptance evidence are retained until
actual account deletion. Client and service-role EXECUTE grants are withheld.

The existing source-only
`supabase/functions/_shared/goalAcceptanceAuthServices.mjs` passes the
exact persisted `reviewId` and server-derived fingerprint to that gateway,
not a client-supplied owner or digest. It remains default-off with no deployed
Edge Function. The **trusted issuance path remains an explicit blocker**:
an authenticated UI confirmation must be independently verified by the
canonical server owner, and the exact visible preview and approved digest
must be recorded before the review row can be issued. This candidate uses
synthetic receipts solely for disposable local SQL acceptance; the
existence of a row does **not** establish that any real user reviewed a Goal.

Validation inputs:
`scripts/test-v2-goals-durable-review-local-postgres.psql` and existing
`.github/workflows/v2-foundation-clean-replay.yml`. No actual hosted
tables, grants, private gateway, user account, or installed device are
changed by these source files. Final publication requires security owner
approval, audited issuance with live session and rate-limit controls,
approved migrations, and real two-account installed-app acceptance.

## 3. Table-by-table proposed contract

### 3.1 public.v2_goals — stable goal identity

Proposed columns:
- id UUID primary key; user_id UUID not null references auth.users(id) on delete cascade.
- goal_kind TEXT not null: race_event, strength_performance, endurance_distance, endurance_time, sport_benchmark, machine_capacity, nutrition_habit, activity_habit, body_composition, general_wellbeing, exploratory_intention or another approved kind. Keep the vocabulary extensible without making each user phrase a new schema type.
- title TEXT not null; description TEXT null; status TEXT not null: draft, active, paused, completed, abandoned, archived.
- active_revision_id UUID null; version BIGINT not null; created_at/updated_at.
- Optional sport_family only when a single primary sport is intrinsic to the goal. Multi-sport goals use typed revision measures and explicit goal relationships rather than one misleading sport label.

Constraints:
- Unique (id,user_id) for same-owner composite foreign keys.
- Goal identity is stable across title, target date and baseline changes.
- Deleting a goal does not delete source activities, race records, exercise identities or training history.
- A goal becomes completed only through the goal owner after validating eligible evidence against the current accepted revision and target comparator. A Coach suggestion or a prediction cannot complete it.

### 3.2 public.v2_goal_revisions — immutable target/baseline intent

Proposed columns:
- id UUID primary key; goal_id UUID not null; user_id UUID not null.
- revision_number INTEGER not null; status TEXT not null: candidate, accepted, superseded, rejected, archived.
- source_kind TEXT not null: athlete_authored, coach_proposal, import_review, controlled_system.
- source_ref TEXT null for the exact proposal/import reference; it is provenance, not a permission grant.
- priority_role TEXT not null: primary, secondary, maintenance, optional. The role is time-scoped to this revision, not an immutable personality trait. Multiple current goals may be `primary`; no unique-primary-per-user constraint is allowed. Optional priority_order INTEGER records the athlete's preferred emphasis when helpful; ties are valid and the athlete may leave it unset.
- start_date DATE null; target_date DATE null; optional check_in_date DATE null; timezone TEXT null only if there is no date/time interpretation requiring one. Missing dates remain null; the system may use created_at for display context but must not represent it as an athlete-selected start date.
- goal_schema_version TEXT not null; created_at, reviewed_at, accepted_at.
- bounded change/rationale summary.

Constraints and rules:
- Unique (goal_id,revision_number) and (id,goal_id,user_id).
- At most one accepted/current revision per goal. A new accepted revision supersedes the old one; historical revisions remain immutable and queryable.
- When both dates exist, target_date must be on or after start_date; date semantics are explicit athlete-local dates where applicable. Neither date is mandatory for a qualitative intention. A check-in date is a review prompt, not a deadline or promise of completion.
- Goal revision acceptance checks expected goal version and exact approval/action ID. Stale revision updates fail rather than overwriting a newer target.
- coach_proposal is never accepted merely because Coach created it. User approval and the canonical Goal writer are required.
- A goal change creates a new revision. It does not rewrite existing Training plan revisions or historical Completed Activity.

### 3.3 public.v2_goal_revision_measures — typed baseline and target

Proposed columns:
- id UUID primary key; goal_revision_id UUID not null; user_id UUID not null.
- metric_code TEXT not null; metric_definition_version INTEGER not null.
- target_operator TEXT not null: greater_than_or_equal, less_than_or_equal, equal, range, complete_event or another tightly controlled comparator.
- baseline_value NUMERIC null; target_value NUMERIC null; lower_bound NUMERIC null; upper_bound NUMERIC null.
- baseline_at TIMESTAMPTZ null; baseline_kind TEXT null: source_measured, provider_derived, user_reported, imported_reviewed, estimated.
- baseline_evidence_id UUID null references the typed measure evidence record when approved; baseline_note TEXT null only for bounded user explanation.
- sort_order INTEGER not null; is_primary BOOLEAN not null default false.

Metric/ownership contract:
- When a goal measure is an activity result (distance, pace, time, load, reps, steps/floors, power, etc.), metric_code + metric_definition_version references ALL-243's canonical v2_activity_metric_definitions. Goals does not clone unit, sport scope, comparison class or metric semantics.
- A strength target such as bench press references the exact ALL-258 exercise ID through the measure's typed goal-kind detail/approved reference contract, and its outcome metric references an ALL-243 strength metric definition. Never use an exercise label alone as identity.
- A race goal references the canonical ALL-234 race ID and uses compatible ALL-243 activity/result metrics. The course/aid station/date is not copied into Goals.
- An unsupported general/skill/consistency target must not be forced into a mismatched completed-activity metric. ALL-222/ALL-239 must decide whether such measures receive a separate product-owned typed measure-definition registry or remain draft-only until a canonical evidence owner exists. This is an explicit DDL blocker, not permission to create a second sport metric catalog.
- Unit, comparator and precision are inherited from the referenced metric contract. No cross-sport or display-unit conversion occurs in the stored target without a named, reviewed conversion.
- Baseline absence remains null. No default 0, 1RM, FTP, pace, floors, weight or distance is inserted.

### 3.4 public.v2_goal_revision_behavior_targets — user-approved habit/behavior intentions

Proposed columns:
- id UUID primary key; goal_revision_id UUID not null; user_id UUID not null.
- behavior_code TEXT null: an approved behavior category when one exists; null is allowed for a plain-language custom intention.
- behavior_description TEXT not null: concise athlete-approved action in the athlete's own words or a reviewed Coach proposal.
- cadence_kind TEXT null: daily, weekly, count_per_period, event_based, or qualitative/no_fixed_cadence.
- target_frequency NUMERIC null and frequency_period TEXT null: both optional; used only when the athlete chooses a measurable cadence.
- evidence_owner TEXT null: references an existing owner such as Training completion, Food Log, Meal Prep or user check-in. Do not create a shadow habit log.
- evidence_policy TEXT not null: user_check_in, canonical_activity, canonical_food_or_meal_prep, mixed, or no_tracking.
- user_confirmed BOOLEAN not null; accepted_at and timestamps.

Rules:
- A qualitative intention may have no numeric metric or fixed cadence.
- A behavior becomes a plan only after the athlete confirms the proposed action and any frequency. Do not turn a broad intention into a long checklist.
- Evidence should come from existing canonical events when available. Self-report remains explicitly user-reported; an unlogged behavior is not assumed to have happened.
- No punitive streaks, missed-day shame, forced notifications or engagement rewards. A missed action prompts a neutral review only when helpful.
- Behavior targets are optional revision children, not another independent Goal or habit engine.
- The user may keep a broad intention active while choosing one small next step; changing the step creates a new revision or superseding behavior target according to the approved version contract.

### 3.5 public.v2_goal_relationships — concurrent and hierarchical goals

Proposed columns:
- id UUID primary key; user_id UUID not null; goal_id UUID not null; related_goal_id UUID not null.
- relation_kind TEXT not null: supports, competes_with, maintenance_for, subgoal_of, replaces or another approved relation.
- effective_from DATE not null; effective_to DATE null; sort_order INTEGER.
- created_at/updated_at.

Rules:
- Both goals must belong to the same user. Self-link is invalid.
- Unique active relationship per exact pair/type/time scope.
- Relationships are explanatory/planning context, not a numeric conversion between sports or an instruction to add training volume.
- Relative priority role is explicitly stored on a goal revision and may also have a user-selected order within the active planning context. A relationship does not automatically make one goal primary or lower another's role.
- **Multiple active primary goals are allowed.** The athlete may actively pursue a race and a physique goal at the same time. The product must not impose a one-primary-goal-per-user database constraint.
- Primary/secondary/maintenance is a planning-priority signal, not a one-goal-only selector. The athlete may mark multiple goals primary; the order is used to explain tradeoffs and schedule emphasis, not to discard other primary goals.
- A goal can be secondary/maintenance to one active training context and primary in another later context. Do not hard-code one global forever-primary flag.

### 3.6 public.v2_goal_measure_evidence — provenance and review lifecycle

Proposed columns:
- id UUID primary key; goal_revision_measure_id UUID not null; user_id UUID not null.
- evidence_kind TEXT not null: completed_activity, official_race_result, user_reported_test, reviewed_import, approved_external_result.
- review_status TEXT not null: candidate, needs_review, accepted, rejected, superseded.
- occurred_at TIMESTAMPTZ null; recorded_at TIMESTAMPTZ not null.
- source quality, exact metric definition version, confirmation/review details and correction/supersession reference.

Typed links (approved only when owning schemas exist):
- v2_goal_activity_evidence: exact ALL-243 completed activity ID and metric-value ID. The activity and metric value must belong to the same athlete; exact metric definition/version must match the revision measure.
- v2_goal_race_evidence: exact ALL-234 race/result identity and result status. It may also link to a Completed Activity when there is a source-backed activity result, but these are not substituted for one another.
- v2_goal_manual_evidence: bounded user-entered measurement, unit derived from the metric definition, explicit confirmed_by_user, capture time and review status. A typed manual claim is user-reported, never automatically reclassified as device-measured.
- Additional source types are not added as free-form source_domain + source_id polymorphic references. Add a typed child/owner contract when a real source domain is approved.

Rules:
- Evidence is append-only; corrections add a superseding/review event rather than overwriting the source fact.
- An estimated prediction may inform coaching context but is ineligible for baseline/goal-completion evidence unless the specific goal definition explicitly allows it (recommended default: never allow estimates to complete a goal).
- An activity only counts when its sport/subtype, metric definition/version, measurement kind, source quality and comparison class satisfy the goal measure.
- DNF/DNS/DQ remain neutral race-result states; no shame/failure goal outcome. A goal can be retired or revised without rewriting race history.

### 3.7 Private idempotency and audit

Proposed allin_private.v2_goal_actions:
- Composite primary key (user_id,client_action_id); goal ID; action type; payload hash; expected/result goal version; resulting revision ID; created time.
- Exact action retry returns original outcome; same action ID with changed payload fails.
- No user-supplied owner override; the server checks p_expected_user_id=auth.uid() before replay lookup and mutation.

Proposed audit:
- Immutable private events for goal created, revision proposed/accepted/rejected/superseded, priority changed, baseline corrected, evidence accepted/rejected, goal completed/abandoned/archived.
- Actor identity and action source are explicit. Athlete edits and Coach-proposed changes are distinguishable.
- Private ledger RLS enabled, no policies, no direct anon/authenticated/service_role grants; narrow owner functions only.

## 3.8 Goal classes and progressive refinement

The goal framework supports these broad, non-exclusive domains:
- **Performance/capability:** race results, distance/time, strength benchmarks, swimming, cycling, stair/elliptical, hike/ruck and sport skills.
- **Body composition/physique:** weight change, muscle development, strength/physique intentions and other user-selected indicators. Scale weight and measurements are optional. Do not promise a six-pack or imply spot reduction; body-composition outcomes vary by person and are not guaranteed.
- **Nutrition/food habits:** eat more consistently, cook at home, improve food variety, include more vegetables, improve protein habits or reduce reliance on takeout. Calorie/macro tracking is optional unless the athlete explicitly chooses it and the required data is adequate.
- **Activity/fitness habits:** walk more, establish an exercise routine, improve mobility or develop consistency.
- **General wellbeing:** feel healthier, improve day-to-day energy or establish a sustainable routine. Keep claims subjective and user-reported unless a supported measure exists.
- **Exploratory intention:** the athlete knows they want a change but is not yet sure what outcome or measure they want.

A goal may move through a progressive refinement path:
1. Plain-language intention (no forced metric/date).
2. Clarified direction and why it matters.
3. One small athlete-approved behavior or next step, optionally with a cadence.
4. Optional measurable baseline/target and check-in window when useful and supported.
5. Accepted coordinated plan/commitments across existing Training, Fuel, Kitchen and Recovery owners.
6. Review and revise based on actual experience and the athlete's feedback.

An athlete may remain at any stage. Not every goal must become a performance plan. Multiple goals may coexist with primary/secondary/maintenance roles and effective dates; Coach must explain tradeoffs rather than collapsing them into a universal score.

## 3.9 Multiple simultaneous goals and coordinated priority

An athlete owns one goal collection with many independently versioned goal identities. More than one goal may be active and important at the same time, including more than one primary goal. The system must not require the athlete to select exactly one life goal.

Example: a user is preparing for a fall marathon and also wants to develop visible abdominal definition. These remain two separate active goals:
- The race goal owns event identity, course evidence, performance outcome and race target date.
- The physique goal owns its own qualitative or optional measurable body-composition direction, with optional behaviors/measures and no forced scale/photo/calorie tracking.
- The athlete may mark both primary. Coach uses their preferred priority order and the actual training/recovery/nutrition context to coordinate the plan.

Coordination rules:
1. Keep each goal's outcome, revision, measures, behavior targets, dates, evidence and progress distinct. Do not merge them into one composite goal or universal score.
2. Build one coordinated Training plan/calendar and one coordinated nutrition/recovery approach when the user approves them. Do not generate separate conflicting plans for each goal.
3. Assess compatibility using the actual goals, available time, current training load, recovery, nutrition evidence and safety context. A physique goal does not automatically mean an aggressive calorie deficit, especially during heavy race preparation.
4. When goals compete (for example a performance peak and a desired rate of weight change), explain the specific tradeoff and offer realistic alternatives: maintain body weight while prioritizing race performance, pursue gradual body-composition change with adjusted expectations, or change the athlete-selected priority/order or timing. Coach must not silently demote, pause or alter either goal.
5. Respect the athlete's chosen importance. If more than one goal is marked primary, preserve that choice and communicate where compromises are required; never force a false hierarchy to simplify scheduling.
6. Secondary and maintenance goals remain visible and supported. Maintenance means a deliberate minimum viable commitment, not abandonment.
7. Each goal can have its own optional timeframe/check-in, but changing one goal's date or state must not silently rewrite another goal's revision.
8. Progress presents separate progress/evidence for each goal and may offer a coordinated summary of how the plan supports the set of goals; it must not invent a combined percentage.
9. Goal relationships such as supports/competes_with are contextual evidence for Coach planning, not automatic mathematical conversion or priority mutation.

## 4. Cross-domain ownership and no-duplicate rules

| Concern | Canonical owner | Goal relationship |
|---|---|---|
| Goal intention, optional baseline/target revision, behavior targets, priority/relationships | Goals — ALL-239 | Owns qualitative and measurable goal identity/revision; does not create plan/activity facts. |
| Daily/weekly plan and workout schedule | Training — ALL-246 | Consumes accepted goal revision; creates separate plan revision/session identities. |
| Completed workout facts and sport metric definitions | Completed Activity — ALL-243 | Provides exact evidence/measure definitions; owns actual values and source provenance. |
| Race/event/course/result | Race/Route — ALL-234 | Provides canonical race/result identity and verified course evidence. |
| Exercise identity/variation/equipment | Exercise Library — ALL-258 | Provides stable lift/movement IDs for Strength targets. |
| Historical evidence coverage/read model | Athlete History — ALL-232 | Supplies bounded history context; never owns goal target or duplicates goal evidence. |
| PRs, Badges, Milestones and user-facing progress | Progress — ALL-249 | Reads Goals and evidence to display progress/awards; does not own canonical goal revisions or activity metrics. |
| Coach proposal and safe Apply | Coach — ALL-231 / ALL-240 | Proposes a revision; Goal owner validates/accepts after user approval. |
| Strength baseline import | ALL-257 | Imports reviewed exercise/set/load evidence into canonical Completed Activity/Strength owner and links it to Goals; no OCR-derived facts promoted blindly. |

## 5. Proposed read/write and security matrix

Goals and goal evidence are user-private by default.

| Object | RLS | Authenticated direct access | Canonical writer |
|---|---|---|---|
| public.v2_goals | Enabled; owner SELECT | SELECT own goals only | Goal create/archive/complete RPCs |
| public.v2_goal_revisions | Enabled; owner SELECT | SELECT own revisions only | Versioned propose/accept/reject RPCs |
| public.v2_goal_revision_measures | Enabled; owner SELECT | SELECT own measures only | Revision writer validates referenced metric definitions/units |
| public.v2_goal_revision_behavior_targets | Enabled; owner SELECT | SELECT own behavior targets only | Goal revision writer validates athlete approval, optional cadence and existing evidence owner references |
| public.v2_goal_relationships | Enabled; owner SELECT | SELECT own relationships only | Relationship writer validates both goal owners and active scope |
| public.v2_goal_measure_evidence | Enabled; owner SELECT | SELECT own evidence only | Typed evidence intake/review RPCs |
| Typed activity/race/manual evidence links | Enabled; owner SELECT | SELECT own linked evidence only | Source-domain/goal owner writer with exact cross-owner FK checks |
| allin_private.v2_goal_actions | Enabled; no policies | No schema/table access | Narrow owner RPCs only |
| Private goal audit events | Enabled; no policies | No schema/table access | Narrow immutable owner writer |

Security rules:
- No anon access and no blanket client INSERT/UPDATE/DELETE on canonical Goals.
- Every user-scoped mutation includes p_expected_user_id and compares it with auth.uid() inside PostgreSQL before mutation/idempotency lookup, following the V2 foundation expected-owner guard.
- Goal revision acceptance and evidence review use expected goal/revision versions; stale changes fail closed.
- Coach is not granted a general goal mutation writer. The action manifest binds exact goal ID, current revision, proposed changes and expected version; only explicit user approval reaches the Goal writer.
- Evidence references are validated against the same user and source metric owner. A user cannot link another user's activity, race result or strength record.
- If SECURITY DEFINER is genuinely required, use postgres ownership, empty search_path, fully qualified object names, explicit actor/owner checks, revoke PUBLIC/anon, and grant only the exact API role. Private helpers remain non-executable to API roles.
- Metric definitions and goal-kind schemas are product-owned/release-controlled. Athletes cannot redefine units, comparison semantics or allowed evidence kinds.
- Export/deletion (ALL-251) includes goals, revisions, relationships, manual evidence and private action/audit metadata; canonical completed activity/race records remain with their own owner retention policy.

## 6. Required operations

Proposed first operation families:
1. Create draft goal with explicit typed kind and initial revision.
2. Add baseline/target measures from supported canonical metric definitions.
3. Add an athlete-reported baseline or a source-backed activity/race evidence reference.
4. Propose a goal revision when target/date/priority changes; show exact before/after and downstream plan impact.
5. Accept/reject the exact revision with expected version/action ID.
6. Add/remove effective-dated goal relationships without converting modalities.
7. Record/review eligible evidence against the exact goal revision/measure.
8. Complete/retire a goal only after checking the exact comparator and accepted evidence contract.
9. Read current goal/revision/evidence with explicit confidence and missing-baseline/coverage warnings.

Training plan creation/rebuild is not part of these Goal operations. When a goal revision changes, Training receives a proposal/invalidation event and decides how to preview the impact; completed/accepted plan history remains unchanged until the athlete reviews/applies a Training revision.

## 7. Migration and implementation sequence after approval

1. ALL-222 and ALL-239 finalize goal kinds, priority roles, revision lifecycle and baseline/target comparator semantics.
2. ALL-243 confirms the exact metric definition/version FKs and evidence link API; ALL-234 confirms race/result identities; ALL-258 confirms exercise reference semantics.
3. ALL-232 confirms what history evidence may be used to prefill a baseline without treating incomplete sync as zero or complete history.
4. ALL-240 confirms the typed Goal revision proposal/approval manifest and exact target/version binding.
5. Author a small migration for Goals, revisions and owner RLS/read APIs. Do not create goal progress snapshots, PR/Badge/Milestone or Training plan tables here.
6. Add typed measures/evidence links only after metric/source owner contracts are approved; include same-user composite FKs and expected-owner/version writers.
7. Add two-user isolation, metric-version/unit mismatch, evidence eligibility, stale revision, exact retry and goal-completion tests.
8. Generate public database types from live schema, prove equality, build read adapters for Training/Progress/Coach, and run migration reset/replay, npm/typecheck/test/Expo gates under ALL-224.

## 8. Required acceptance tests before DDL is deployable

- Two athletes cannot read, update or attach evidence to each other's goals/revisions/measures.
- Expected-user mismatch fails 42501 even if the client changes account between local session check and RPC.
- Exact retry returns original revision; same action ID with a different payload fails.
- A new accepted revision supersedes the prior one without rewriting historical target/baseline/evidence or accepted Training plans.
- A 300 lb bench goal references the exact bench exercise identity, baseline proof, load unit, rep target and valid progression horizon; unknown baseline stays unknown.
- A 100-mile cycling goal references cycling-specific distance/duration/elevation measures; it is not satisfied by running mileage.
- Pool and open-water swim goals have distinct sport/protocol/units; CSS is not inferred from ordinary pace.
- Stair-stepper goals use exact steps/floors/vertical only when source/device actually supplies the value; no generic distance conversion.
- Race goal references canonical race identity and versioned course evidence; a changed course version triggers review rather than silently changing historical goals.
- Primary/secondary/maintenance roles are revision-scoped; concurrent goals do not become one opaque weighted score.
- Predicted performance does not complete a goal or become an official result.
- DNF/DNS/DQ are neutral result states; no failure/shame badge is written by Goals.
- Goal completion requires evidence of the correct metric definition/version, unit, comparator and acceptable source/quality.
- Progress reads canonical goal/evidence and displays trend/PR/Badge/Milestone without storing a shadow goal or activity record.
- Goal/plan revision changes preserve accepted Training history and require explicit downstream Training review.
- Incomplete sport/device coverage remains visible; missing data cannot complete or regress a goal.

## 9. Owner decisions required before DDL

1. Final controlled goal-kind and sport vocabulary; how non-sport skill/consistency goals receive a canonical measure.
2. Whether goals are long-lived identities with immutable revisions for every target/priority/date change (recommended).
3. Whether priority role is always revision-scoped or additionally has an active planning-context assignment; do not duplicate Training's plan goal hierarchy.
4. Exact allowed goal metric definition sources and how goals handle measures that are not Completed Activity metrics.
5. Baseline sources and acceptance standards for user-reported, imported, official race and device-measured baselines.
6. Comparator/tolerance rules for ranges, minimums, duration targets and complete-event goals.
7. Cross-goal relationships: supported types and whether goal conflicts are explanatory or feed Coach planning constraints.
8. Evidence link contracts with ALL-243 and ALL-234, including metric definition version and same-owner FKs.
9. Exercise/Strength target reference contracts with ALL-258/257, including load mode, reps and testing protocol.
10. How Goal completion is signaled to Progress/Community without creating duplicate PR/Badge/Milestone state.
11. Retention/export/deletion of manual baseline and goal evidence; activity/race source retention remains with source owner.
12. How accepted goal revisions inform Training replan preview, and what changes require a new Training revision.

Until these decisions are approved, do not create Goals DDL, seed an unreviewed goal metric catalog, expose Goal write RPCs or claim all-sport goal persistence is implemented.


## 10. Non-race lifestyle goals — founder-approved extension, 2026-11-10

The goal model must serve an athlete with no race, benchmark or numeric body target. Example starting statements include “I want to eat better,” “I want to get in shape,” “I want to lose some weight,” “I want to build muscle,” “I want a six-pack,” or “I want to feel healthier.”

Required behavior:
- These are valid goals and must not be rejected or forced into the race-plan schema.
- A broad intention can be saved/started without a measured baseline, numeric target, calorie target, goal weight, start date or target deadline.
- Coach converses to understand what the user means and what is realistic in their life (work schedule, budget, food preferences, cooking access, current activity, exercise access and tracking preferences) without turning onboarding into an interrogation.
- Coach offers one or two useful starting actions, not a long generic checklist. User chooses/approves the behavior and any cadence. Examples may include cooking a few meals at home, adding a walk, establishing a manageable strength routine or improving meal consistency.
- Weight-loss and physique goals coordinate Nutrition/Fuel, Training/Strength, activity and Recovery. No aggressive restriction, mandatory weigh-ins, guaranteed visible abs, spot-reduction claims or forced calorie/macro tracking. Scale weight, body measurements and photos are optional and private.
- “Eat better” does not automatically mean weight loss or calorie tracking. Coach first discovers what better means to that athlete; nutrition improvements can use behavior goals and qualitative check-ins.
- General wellbeing goals use user-reported feedback unless a canonical evidence measure exists. No invented universal wellness score.
- Goals may be refined later into measurable outcomes or behaviors without losing the original intention/history. Adding a measurable target or deadline is a new revision and requires user approval.
- Progress presents goal-specific evidence and optional self-assessment. It avoids punitive streaks or shame for missed habits, and never celebrates dangerous restriction/overtraining.

No new global habit engine, calorie engine or body-composition scoring system is authorized. Behavior evidence reuses existing Training, Food Log, Meal Prep and user-check-in sources.


## 11. Founder-approved multi-goal example — race + physique

A user may say: “My goal is to run this race and work toward a six-pack.” The onboarding/Coach flow should create or retain two distinct active goals under the same athlete, allow both to be marked primary, and then coordinate them:
- Preserve the race as a sport/event-specific Training objective with its own date and course requirements.
- Preserve the physique direction as a separate body-composition goal with optional weight/measurement behaviors.
- Coach checks the race phase and demands before suggesting nutrition or training changes. During high-volume or peak race preparation it should avoid aggressive weight-loss prescriptions and explain where physique changes may need to be slower or deferred.
- Offer a user-controlled priority/order or timing change only after explaining the tradeoff; no silent pause, demotion or target adjustment.
- Both goals remain separately visible in Progress and share only the actual canonical Training/Fuel/Recovery evidence.

No separate goal collection or parallel plans per domain are allowed.
