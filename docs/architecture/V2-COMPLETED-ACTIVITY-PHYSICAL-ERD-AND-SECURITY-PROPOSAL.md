# V2 Completed Activity — Physical ERD & Security Proposal

**Status:** Proposed physical model for ALL-222 / ALL-243 owner review; NOT deployed or migration-approved  
**Domain owner:** ALL-243 — Completed Activity  
**Consumers:** ALL-246 Training; ALL-245 Watch/HealthKit/Equipment; ALL-232 Athlete History; ALL-249 Progress; ALL-231 Coach; ALL-250 Today; ALL-244 Community/RaceHub; ALL-256 Historical Import; ALL-257 Strength History Import; ALL-258 Exercise Library  
**Repository:** allinproject/All-In-V2  
**Branch:** integration/v2-foundation  
**Canonical backend:** Supabase project xarhuczrtzuiljmtdaeu  
**Reviewed:** 2026-11-10

> This is a physical-schema proposal for owner review, not a deployed ERD. No Completed Activity tables, metric registry, Storage bucket, RPCs or migrations are created by this document. ALL-222 and ALL-243 must approve the identity, metric/value model, source merge rules, series/route storage and security contract before DDL.

## 1. Binding ownership and product contracts

1. Completed Activity owns one canonical record for each finished physical workout/activity, its sport identity, trusted facts, sport-specific detail and metric provenance.
2. Product rule: **store everything trustworthy; show the important few first; place useful source-backed detail in Advanced Stats; explain meaning in Analysis; never fabricate unsupported data.**
3. Overview, Advanced Stats and Analysis are projections of the same canonical activity and metric registry, not separate stores.
4. A single physical activity can have multiple source records (for example Watch plus HealthKit) but only one canonical activity identity. Source merge/dedupe is evidence-based and idempotent.
5. Planned workout, live execution and completed activity are different identities. Training owns the plan and active session; Completed Activity owns the finished record and metric registry.
6. Strength set/exercise results, multisport legs/transitions, swim lengths/sets and semantic laps/splits remain explicit structured detail. Do not flatten them into meaningless scalar totals.
7. Source-reported, user-reported, provider-derived, ALL IN-derived and estimated values are distinct kinds with explicit source/authority and version. A derived value never silently becomes a measured value.
8. A missing value is unknown/absent, never zero. An explicit measured zero is a real value row. A field not supported by a source is not synthesized by the UI.
9. Large/raw GPS, heart-rate, power and FIT payloads do not belong in a generic metric JSON blob or a client-readable table. Store bounded metadata and authorized object references; preserve the original source identity and checksum where retention is approved.
10. Coach analysis, Progress/PRs, Community/RaceHub and Athlete History consume this canonical activity. They do not create another activity/history record.

## 2. Proposed physical ERD

The model separates canonical activity identity, source provenance, a versioned metric vocabulary, typed metric values, semantic segments, strength results and bounded time-series/route objects.

~~~mermaid
erDiagram
  auth_users ||--o{ v2_completed_activities : owns
  v2_completed_activities ||--o{ v2_activity_sources : provenance
  v2_completed_activities ||--o{ v2_activity_metric_values : values
  v2_completed_activities ||--o{ v2_activity_segments : structure
  v2_completed_activities ||--o{ v2_activity_series : samples
  v2_completed_activities ||--o| v2_activity_route_objects : route
  v2_completed_activities ||--o{ v2_activity_strength_sets : strength
  v2_activity_segments ||--o{ v2_activity_metric_values : segment_values
  v2_activity_segments ||--o{ v2_activity_series : segment_samples
  v2_activity_metric_definitions ||--o{ v2_activity_metric_values : definition
  v2_activity_metric_definitions ||--o{ v2_activity_series : series_metric
  v2_completed_activities ||--o{ v2_activity_strength_sets : exercise_results
  v2_activity_sources ||--o{ v2_activity_ingest_events : ingest
  allin_private_v2_activity_actions ||--o{ v2_completed_activities : idempotency

  v2_completed_activities {
    uuid id PK
    uuid user_id FK
    text sport
    text sport_subtype
    timestamptz started_at
    timestamptz finished_at
    date athlete_local_date
    text timezone
    text capture_kind
    text status
    bigint version
  }
  v2_activity_sources {
    uuid id PK
    uuid activity_id FK
    text provider
    text source_kind
    text source_record_id
    text source_revision
    text quality
    timestamptz captured_at
    timestamptz received_at
  }
  v2_activity_metric_definitions {
    text metric_code PK
    integer definition_version PK
    text canonical_unit
    text value_kind
    text sport_scope
    text capture_kind
    text comparison_class
    boolean chartable
  }
  v2_activity_metric_values {
    uuid id PK
    uuid activity_id FK
    uuid segment_id FK
    text metric_code FK
    integer definition_version FK
    numeric value_numeric
    text value_text
    boolean value_boolean
    text measurement_kind
    text quality
    uuid source_id FK
  }
  v2_activity_segments {
    uuid id PK
    uuid activity_id FK
    uuid parent_segment_id FK
    text segment_kind
    text sport
    integer sequence_number
    timestamptz started_at
    timestamptz finished_at
  }
  v2_activity_series {
    uuid id PK
    uuid activity_id FK
    uuid segment_id FK
    text metric_code FK
    text object_path
    text encoding
    integer sample_count
    timestamptz started_at
    timestamptz finished_at
    text quality
  }
  v2_activity_route_objects {
    uuid id PK
    uuid activity_id FK
    text object_path
    text format
    numeric distance_meters
    integer point_count
    text quality
  }
  v2_activity_strength_sets {
    uuid id PK
    uuid activity_id FK
    uuid segment_id FK
    uuid exercise_id
    integer sequence_number
    numeric load_value
    text load_unit
    integer reps
    numeric rir
    numeric rpe
  }
~~~

Private action and ingest-operation records remain in allin_private and are intentionally not part of the public/client model. Route and series object paths refer to private Supabase Storage objects with separate owner policies.

## 3. Table-by-table proposed contract

### 3.1 public.v2_completed_activities — canonical completed identity

Proposed columns:
- id UUID primary key; user_id UUID not null references auth.users(id) on delete cascade.
- sport TEXT not null: canonical sport family (running, cycling, swimming, strength, hiking, rucking, rowing, elliptical, stair, yoga, mobility, other).
- sport_subtype TEXT null: road/trail/treadmill, indoor/outdoor ride, pool/open-water, machine subtype, event discipline or another reviewed subtype.
- activity_kind TEXT not null: workout, race/competition, manual_entry, free_activity or another reviewed activity category. Keep exact sport separate.
- started_at and finished_at TIMESTAMPTZ null; athlete_local_date DATE not null; timezone TEXT not null.
- duration_seconds INTEGER null; elapsed_seconds INTEGER null only where a source supplies/defines it; no inferred elapsed-vs-moving equivalence.
- capture_kind TEXT not null: device_measured, provider_import, user_reported, manual_only, mixed_sources.
- status TEXT not null: completed, partial, needs_review, invalidated. Do not use one boolean to hide partial/poor quality.
- linked Training reference: optional training_session_instance_id and exact plan_revision_session_id, added only with the ALL-246/ALL-243 shared identity contract approved.
- version BIGINT not null; created_at/updated_at.

Constraints:
- Unique (id,user_id) for same-owner composite FKs.
- start/end ordering enforced when both timestamps exist. Date/timezone preserved independently; do not rebuild athlete-local date from a UTC date.
- Activity ID is stable. Corrected source/metric evidence updates a versioned fact or adds a correction record; it does not create a second activity identity.
- No universal required distance/duration fields: Strength, mobility and some manual sessions legitimately lack them.
- Deleting/replacing the exact source record must not silently delete a canonical activity that also has another valid source.

### 3.2 public.v2_activity_sources — provenance and deduplication

Proposed columns:
- id UUID primary key; activity_id UUID not null; user_id UUID not null.
- provider TEXT not null: apple_healthkit, apple_watch, supported_equipment, manual, import, or later approved Garmin/COROS.
- source_kind TEXT not null: workout_record, sensor_summary, manual_record, device_session, imported_historical_record.
- source_record_id TEXT not null; source_revision TEXT null; source_device_ref TEXT null.
- quality TEXT not null: trusted, partial, unverified, low_quality, rejected.
- captured_at TIMESTAMPTZ null; received_at TIMESTAMPTZ not null.
- source_payload_hash TEXT null; source_metadata JSONB bounded/allowlisted.

Constraints and rules:
- Unique (provider,source_kind,source_record_id) within the approved identity scope; exact external IDs retain their original formatting.
- Unique source IDs make provider retry delivery idempotent. A source row can only be linked to one canonical activity unless an explicit reviewed source-split rule exists.
- One canonical activity can have multiple sources. Merge requires evidence that identity, time window, sport/subtype and overlap refer to the same physical event.
- Preserve capture and receive times separately. Provider sync time is not activity start time.
- Store only bounded attribution/source metadata; do not copy raw HealthKit/FIT payloads or personal user context into this table.
- A low-quality source can contribute a value only when the metric contract admits it; source confidence is not hidden in a generic activity-level score.

### 3.3 public.v2_activity_metric_definitions — one versioned metric registry

Proposed columns:
- metric_code TEXT not null; definition_version INTEGER not null; composite primary key.
- display_name TEXT not null; description TEXT null; canonical_unit TEXT null.
- value_kind TEXT not null: numeric, text, boolean or structured_reference.
- sport_scope TEXT[] or an explicit normalized applicability relation; the final representation must not become an unchecked free-form list.
- capture_kind_allowed TEXT[] / controlled source classes.
- measurement_kind_allowed TEXT[]: source_measured, provider_derived, user_reported, allin_derived, estimated.
- comparison_class TEXT null: exact comparability group; null means do not compare as a performance measure.
- display_group TEXT not null; overview_rank INTEGER; advanced_group TEXT; sort_order INTEGER.
- chartable BOOLEAN; segment_eligible BOOLEAN; privacy_class TEXT; status TEXT.
- calculation_authority TEXT null; calculation_version TEXT null for derived definitions.

Rules:
- Metric code is stable; changing unit, semantics or calculation authority creates a new definition version.
- A metric definition says what the number means, its canonical unit and its allowed source/value kinds. UI never infers meaning from a field name.
- Sport/subtype applicability is explicit. A swimming split is not a generic run lap; stair floors do not become running elevation; cycling power does not become run pace.
- Comparison eligibility is not implied by having the same unit. Machine levels, device-specific resistance and different protocols may be explicitly non-comparable.
- Metric definitions are product-owned reference data; athletes cannot insert, update, retire or change a canonical metric definition.
- Registry publication is controlled by migrations/seeds until an authorized operator process is approved.

Initial registry families (not a full approved metric list):
- Shared activity context: elapsed time, moving time only where supplied, session RPE, HR zones with source/protocol, elevation gain/loss where supported.
- Run: distance, pace/speed, cadence, vertical oscillation/ratio, ground-contact metrics, splits, lap/interval targets vs actual.
- Ride: distance, speed, cadence, power, normalized power only from a trusted calculation, FTP snapshot reference, climbing/elevation.
- Swim: pool length/unit, distance, active/elapsed time, pace per 50/100, stroke/count/rate, SWOLF/efficiency only when the source/protocol defines it, CSS only from a reviewed protocol/trusted input.
- Elliptical/stair-stepper: machine-reported distance, stride/step rate, device-specific level, floors/steps/vertical/watts only if source supplies them.
- Strength: exercises, set count, reps, load and units, RPE/RIR, bodyweight/load mode and exercise identity.
- Multisport: leg-specific duration/distance/metrics and transitions, with overall elapsed time kept separate.

### 3.4 public.v2_activity_metric_values — typed scalar facts

Proposed columns:
- id UUID primary key; activity_id UUID not null; user_id UUID not null.
- segment_id UUID null to scope a value to a specific leg, split, lap, interval or swim set.
- metric_code TEXT not null; definition_version INTEGER not null.
- value_numeric NUMERIC null; value_text TEXT null; value_boolean BOOLEAN null; structured_reference JSONB/UUID only if the registry explicitly declares it.
- measurement_kind TEXT not null; quality TEXT not null.
- source_id UUID null; source_detail JSONB bounded; captured_at/recorded_at.

Constraints and rules:
- Exactly one value column is populated in accordance with the registry value_kind. Numeric values use canonical units from the referenced definition version.
- Missing metric = no value row. Known zero = numeric value row with zero. Never insert a fake zero to satisfy an expected UI card.
- A metric can have multiple source observations. The canonical selected value must preserve its selected source and quality; do not overwrite conflicting observations without a resolution rule.
- A user correction adds a corrected value/evidence record or explicit supersession; original source evidence remains auditably available.
- Derived/estimated values require the exact calculation authority/version and input fingerprint. Historical metric definitions/zone changes do not retroactively rewrite an old activity without an explicit rebuild/version record.
- Segment-scoped metric FK must prove the segment belongs to the same activity/user.

### 3.5 public.v2_activity_segments — semantic activity structure

Proposed columns:
- id UUID primary key; activity_id UUID not null; user_id UUID not null.
- parent_segment_id UUID null; sequence_number INTEGER not null; segment_kind TEXT not null.
- sport TEXT null; label TEXT null; started_at/finished_at; elapsed_seconds/distance_meters only when supplied or safely derived under a named authority.
- exact semantic type: lap, split, interval, swim_set, swim_length, multisport_leg, transition, strength_block or another reviewed kind.

Rules:
- Unique (activity_id,sequence_number) within sibling/order scope, with explicit parent relationship for nested segments.
- Semantic segment type is mandatory. A swimming length, running split, cycling lap, interval and multisport transition are not interchangeable.
- Multisport activity is one parent activity with ordered sport legs and explicit transitions; do not combine nearby unrelated activities into a brick.
- Planned target and actual result remain separate. If a segment is linked to a Training revision session/target, keep the exact plan revision and comparable target identity.
- Missing pace/stroke/power/floors/energy remains unknown even when segment distance/duration exists.

### 3.6 Strength detail and Exercise Library relationship

Proposed strength result table:
- id UUID primary key; activity_id/user_id; segment_id; exercise_id UUID referencing ALL-258 only when its canonical exercise schema is approved.
- sequence_number; set_type (warmup/work/drop/superset/etc. under reviewed vocabulary); reps; load_value/load_unit; load_mode (external_load/bodyweight/assisted/unknown); RPE; RIR; duration if applicable; result quality/source.
- Stable block/superset/group identity and order; do not flatten four major-plus-ab supersets into a generic exercise list.
- Bodyweight and assisted work do not fabricate an external load. Unknown working weight remains unknown.
- Exercise ID is canonical; activity stores performed result and optional variation/notes, not a duplicate exercise catalog.
- User-entered/imported lift history remains source-tagged. Imported sets do not silently become verified PRs.

### 3.7 Series, route and large evidence payloads

Proposed public metadata:
- public.v2_activity_series: activity_id/user_id; optional segment_id; metric_code/definition_version; object_path; encoding; sample_count; sample_interval_ms; start/end; source_id; quality; checksum; created_at.
- public.v2_activity_route_objects: activity_id/user_id; object_path; format (GPX/FIT/encoded route or another reviewed representation); point_count; distance summary; quality; checksum; source reference.

Storage rules:
- Raw high-volume series/route objects reside in private Supabase Storage, not in large public-table JSON arrays or one row per sensor sample.
- Storage paths are owner-scoped and non-guessable. Storage object SELECT/INSERT/UPDATE/DELETE policies bind the object path/metadata to the activity owner; clients do not receive service-role access.
- Database metadata is the authorization/retention pointer. Deleting or correcting an activity must reconcile the related object and any immutable source-retention requirement.
- A route/series can be absent while the scalar activity is valid. The UI hides unavailable charts/maps and reports partial source coverage rather than inventing a line.
- Bounded chart sampling/downsampling preserves source range and exact source metadata; interpolation is display-only and is never persisted as measured fact.
- The exact Storage bucket name, allowed formats, max byte/sample counts and retention schedule are release decisions for ALL-243/245/251 before bucket/policy DDL.

### 3.8 Private idempotency and ingestion operations

Proposed private operation ledgers in allin_private:
- activity action ledger keyed by (user_id,client_action_id), with operation type, target activity, payload hash, expected version, result version/reference and timestamp.
- source ingest ledger keyed by provider/source identity, with payload checksum, ingest status, activity link, source version and retry metadata.
- immutable correction/merge audit event records for activity source reconciliation.

Rules:
- Exact same request/source event replay returns the existing result; changed payload under the same action/source identity fails.
- The private operation tables have RLS enabled, no policies and no direct grants to anon/authenticated/service_role. Only narrow owner/service functions access them.
- Do not create a raw-provider-payload cache here. Source observations/authorized metric values are separate from ALL-227's public upstream response cache.
- No generic Coach write function or user-supplied source provider can directly set verification status.

## 4. Cross-domain ownership and relationship contract

| Concern | Owner | Activity relationship |
|---|---|---|
| Planned workout, plan revision, active session | Training — ALL-246 | Optional exact plan revision-session and Training session-instance reference; no Training plan rows duplicated. |
| Device permissions, HealthKit/Watch/FTMS acquisition and source events | Devices — ALL-245 | Source link plus provenance; observations attach to the canonical activity/session. |
| Canonical metric vocabulary, value semantics and sport-aware detail | Completed Activity — ALL-243 | Owns registry and canonical values. |
| Canonical exercise IDs and movement definition | Exercise Library — ALL-258 | Strength results reference exercise IDs; no catalog clone. |
| Goals, races, race results and PR/achievement lifecycle | Goals/Progress — ALL-239/249 | Activity can be evidence for goal/race outcome; does not own the goal or permanent PR model. |
| Athlete History read model | ALL-232 | Bounded owner-reader queries with per-sport/time-window coverage. No second activity store. |
| Coach interpretation and recommendations | ALL-231/217 | Reads exact activity/metric identities; explanations do not mutate source facts. |
| Community/RaceHub visibility and post identity | ALL-244 | Posts may reference an activity and apply privacy policy; no duplicate completed workout record. |
| Historical source import | ALL-256/257 | Idempotent importer maps to canonical activity/source registry with explicit provenance and user authorization. |

## 5. Proposed read/write and security matrix

All completed activity facts are user-private by default.

| Object | RLS | Authenticated direct access | Canonical writer |
|---|---|---|---|
| public.v2_completed_activities | Enabled; owner SELECT | SELECT own activity rows | Manual activity/import/Training completion APIs with expected-owner and source guards |
| public.v2_activity_sources | Enabled; owner SELECT | SELECT own linked source metadata | Source ingest/merge APIs |
| public.v2_activity_metric_definitions | Enabled; published SELECT | SELECT active published registry rows | Controlled release/migration writer |
| public.v2_activity_metric_values | Enabled; owner SELECT | SELECT own values | Source ingest, manual correction or named derived-metric writer |
| public.v2_activity_segments | Enabled; owner SELECT | SELECT own semantic segments | Source ingest or trusted correction writer |
| public.v2_activity_strength_sets | Enabled; owner SELECT | SELECT own set results | Source/manual ingest writer |
| public.v2_activity_series | Enabled; owner SELECT | SELECT own metadata; object access separately checked | Trusted series ingest / Storage upload finalization |
| public.v2_activity_route_objects | Enabled; owner SELECT | SELECT own route metadata; object access separately checked | Trusted route ingest / Storage upload finalization |
| allin_private activity action/ingest/audit ledgers | Enabled; no policies | No schema/table access | Narrow owner functions only |

Security rules:
- No anon access to private activities or metric values. No blanket client INSERT/UPDATE/DELETE to canonical records.
- Every user-scoped RPC takes p_expected_user_id and compares it to auth.uid() inside PostgreSQL before action replay lookup or mutation, following the current expected-owner foundation contract.
- User manual entry is an authenticated, allowlisted writer with source_kind=user_reported/manual; it cannot claim device-measured provenance or fabricate GPS/elevation/sensor data.
- Device/provider ingestion is server-side and checks authorized account/device/session binding. Provider credentials and service-role keys never appear in the mobile bundle.
- SECURITY DEFINER functions require postgres ownership, empty search_path, fully qualified objects, explicit expected-user/source authorization and least-privilege EXECUTE. Private helpers are not executable through the public API. Advisor WARNs are documented only when the operation truly requires an exposed owner-checked RPC.
- Metric registry write access is limited to controlled release operations. Athletes cannot redefine canonical units, source requirements, comparability or calculation authority.
- Storage objects are private, owner scoped and verified against the owning activity/series/route metadata. Direct object path guessing is not authorization.
- Export/deletion (ALL-251) includes canonical rows, source/metric/segment/series metadata and Storage object lifecycle. Preserve only what legal retention permits; do not silently retain personal route/health data in an untracked cache.

## 6. Event, merge and metric selection rules

- A canonical activity ID is stable across device/provider duplicate delivery and manual correction.
- Source records retain provider ID, capture/receive time, source revision and quality. Same source event retry cannot create another activity.
- If Watch and HealthKit both report the same workout, a reviewed dedupe policy uses source identity/time overlap/sport and user context; it does not create two activities just because two sources exist.
- Metric selection is per metric, not per activity-wide winner. A trusted HR series can come from one source while distance/route comes from another, provided the evidence is compatible and source link retained.
- Contradictory values are not averaged by default. Preserve observations and mark conflict/needs_review or choose by a documented metric-specific source authority.
- User correction adds a correction event/value with actor and time; source observations remain available for audit.
- Derived metric values include exact formula/model version, input metric IDs/revisions and a fingerprint. Recomputing a new formula creates a new derived version; past displayed interpretations are not silently rewritten.
- Historical FTP/HR max/zone changes do not retroactively reinterpret raw historical facts. A new analysis snapshot may be computed with a new profile version and clearly labeled.
- Activity finish is not the same as metric completeness. A valid completed activity may have partial details; completeness and quality are explicit.

## 7. Required operations and RPC families

Proposed first operations:
1. Create a manual completed activity with exact source/capture kind and user-reported facts.
2. Ingest a provider/device activity source idempotently and reconcile it to one canonical activity.
3. Add/reconcile metric values with registry-version, source and quality validation.
4. Add semantic segments and sport-specific result detail.
5. Attach bounded series/route metadata after the private Storage object upload is verified.
6. Apply a user correction with an immutable correction record.
7. Merge duplicate source records into an existing canonical activity with auditable decision.
8. Query owner-scoped activity overview/advanced-stat/analysis read models.
9. Consume Training completion handoff idempotently and return the single canonical activity ID.
10. Reconcile pending source imports and partial coverage without inventing missing metrics.

The first slice must not implement a second Training session engine, generic cross-sport scoring, permanent PR calculation, Community post writer or Coach mutator.

## 8. Required acceptance tests before DDL is deployable

- Two users cannot read or mutate each other's activity, metric, source, route, series or strength-result rows.
- Wrong expected-user UUID fails 42501 even after an account switch between client check and RPC.
- Exact source retry and exact action retry return the same canonical activity; altered-payload key reuse fails.
- Watch + HealthKit duplicate delivery does not create two activities; distinct workouts close in time are not incorrectly merged.
- Missing metric row remains unknown; explicit numeric zero remains zero.
- Unit, sport scope, definition version and measurement_kind are checked before a value becomes visible.
- Provider-derived, user-reported, source-measured, ALL IN-derived and estimated values remain distinct.
- Manual entry does not gain synthetic GPS/elevation/pace/HR/route/strength weights.
- Strength bodyweight/assisted/unknown load modes are distinct; exercise IDs reference ALL-258; approved superset/block/set order survives import.
- Pool/open-water swim are distinct; yards/meters preserved; send-off vs fixed rest preserved; manual drill/kick credit never becomes sensor distance; missing stroke/SWOLF/CSS remains unknown.
- Elliptical and stair-stepper remain distinct; machine-level values are not compared across incompatible devices; floors/steps/watts only appear when supplied.
- Multisport has one parent activity with ordered legs and transitions; unrelated sessions cannot be stitched into a brick.
- Time-series/route object access is owner-scoped; unauthorized path access fails; checksum, payload bounds, deletion and correction are tested.
- Derived values record calculation authority/version and input fingerprint; historical settings edits do not rewrite source facts.
- Training outbox replay creates exactly one activity and leaves a traceable delivery result.
- Athlete History sees source and coverage gaps; Progress/PR and Community consume the canonical ID rather than storing a shadow workout.
- Activity can be completed with partial metrics; Overview/Advanced Stats hides absent sections and Analysis does not invent missing data.

## 9. Owner decisions required before DDL

1. Final stable activity identity and whether the canonical parent distinguishes workout, race/competition, manual entry and multisport.
2. Source dedupe/merge rules across Watch, HealthKit, manual entry and future provider imports, including time-window/overlap confidence.
3. Metric registry representation: normalized sport applicability table vs constrained array; exact metric versioning/retirement semantics.
4. Typed metric value model for numeric/text/boolean/reference values and unit conversion authority.
5. Semantic segment taxonomy and exact hierarchy for split/lap/interval/swim-length/multisport-leg/transition/strength-block.
6. Strength set schema alignment with ALL-258, ALL-257 imports and bodyweight/assisted/load semantics.
7. Series and route storage bucket, size/sample limits, compression, sampling/downsampling, checksum, retention, export and deletion rules with ALL-245/251.
8. Source-quality hierarchy and metric-specific conflict resolution; never default to first provider or average contradictory values.
9. The Training completion outbox contract: source/session key, synchronous vs asynchronous delivery, pending/retry/reconciliation UX and exactly-once idempotency.
10. Derived metric calculation authority/version/input fingerprint and how historical profile changes affect new analysis snapshots.
11. Privacy rules for route/location/Health data, public Community references and per-activity visibility.
12. Whether source payload evidence is retained at all after normalized metric ingestion, and under what licensing/consent/retention limits.

Until these decisions are approved, do not create Completed Activity DDL, seed an unreviewed metric registry, expose metric-write RPCs or claim the Completed Activity database is implemented.


## 10. Typed finish-to-Completed Activity handoff — review contract, 2026-11-11

**Implementation status:** The client-side contract module `apps/mobile-v2/src/features/training/completedActivityHandoffContract.ts` and its tests are committed. It is NOT an approved database function, deployed outbox, authenticated consumer or actual finished-workout pipeline.

Training's terminal finish transaction should produce **exactly one** immutable completion event keyed by the stable training session instance plus immutable source reference, while the ALL-243 writer remains the **only** owner that assigns the canonical completed activity ID. `CompletionHandoff` carries owner ID, event ID, Training session instance ID, immutable finish event ID, source kind/record identity, actual canonical sport + subtype, athlete-local date/timezone, source-backed finish timestamp, and exact optional accepted plan revision-session ID. These identities must be checked for consistent same-owner relationships server-side.

**Proposed receipt states:** `pending` means the finish event/outbox exists but the canonical activity writer has not returned an activity ID; `needs_review` means reconciliation is unresolved; `ready` is permitted only with a true canonical ID returned by ALL-243. No pending/review receipt may claim a completed activity ID or navigate as a saved workout. A retry with the same immutable event identity but different payload is a conflict, not an overwrite. Backend must add a uniqueness constraint and idempotent transactional consume/write/acknowledge behavior, with recovery from worker failure and cross-provider deduplication. Two independent source events for the same physical workout still require an **approved** evidence-based merge policy, never inferred from proximity alone.

**No optional equipment prompt belongs in finish.** Athlete-facing finish can complete immediately and show a truthful pending/reconciliation state while any downstream ingestion finishes. On the saved Completed Activity, optional terrain, shoes, bike, effort and notes are editable without duplicate mileage.

**Before migration:** ALL-222/246/243 must choose and approve the durable outbox vs synchronous same-transaction handoff mechanism, sequence/uniqueness constraints and exact source dedupe, cancellation/recovery and delivery retries, least-privilege worker/RLS grants and bounded retention/export/deletion. `CompletionHandoff` is a reviewable typed compatibility target, **not an authorization to deploy DDL**. The mobile client checks are defense in depth, not substitutes for SQL authorization.


## 11. Source reconciliation policy checkpoint — 2026-11-11

**Reusable policy implementation, not a deployed consumer:** `apps/mobile-v2/src/features/training/completedActivitySourceReconciliation.ts` is a pure decision function used to specify and test approved-in-principle safety behavior; the future ALL-243 backend remains authoritative. It consumes owner-verified source candidates, not device self-assertions or a client-accepted session claim. It must **not** be used as a persistent uniqueness guarantee: PostgreSQL composite keys, server checks and transactions are still required.

The decision vocabulary deliberately differentiates:
- `exact_replay`: same owner/provider/source-kind/exact external record ID, same source revision and fingerprint, same certified session link, and one unambiguous canonical activity
- `revision_review`: identical external source identity but changed revision, payload fingerprint, or certified session link; keep original measurements and reconcile through authorized correction/version workflow
- `attach_certified_session`: distinct provider source identity with a **server-certified** exact common Training-session link and a single existing canonical activity target; safe to propose attachment for the canonical backend, not automatically accept client assertions
- `needs_review`: conflicting canonical IDs, mismatched certified session links, or any overlapping-source candidates without certified exact identity; **never** merge solely on similar sport/start time/distance/route
- `new_activity_candidate`: no matching exact source, certified same-session linkage or overlapping candidates; backend must still validate identity and write atomically before declaring a new activity

The candidate list supplied by the owner must be bounded and scoped to **the same source key or plausibly overlapping activity window**. It must not be the user's entire workout history or every independent new workout would get stuck in review. The owner must preserve candidate-query coverage and reject ambiguous matches, not let the client choose the winner.

The policy's returned `activityId` is only a linkage proposal. No result is a persisted activity without server transaction acknowledgement. The `ready` receipt from §10 is the only navigation-enabling state.

**Still blocked:** schema approval, indexed uniqueness, account-isolated RLS, race-safe consumer, provider-specific match tolerance, exact Training session certification, conflict/resolution audit, privacy-safe source raw-data lifecycle and two-session PostgreSQL race tests. Source attachments with partial/unknown timing must retain review state until sufficient evidence arrives.


## 12. Database release-readiness contract — next schema review decision (2026-11-11)

This section is a **review packet, not migration approval or deployed DDL**. It extends the existing ALL-222/ALL-243/ALL-246 ownership model; do not create a competing activity writer, history aggregate or unreviewed public API.

### Recommended canonical keys and database enforcement

| Object / event | Proposed uniqueness / relation | Mandatory enforcement / failure mode |
| --- | --- | --- |
| Completed Activity parent | `(id, user_id)` same-owner composite identity; optional `(user_id, training_session_instance_id)` unique when non-null | Source import may have no Training session; a present session link must be owner-certified and cannot point to two completed activities |
| Source observation identity | `(user_id, provider, source_kind, source_record_id)` exact external key | Provider/source key scope per athlete, immutable origin; retries with changed revision/fingerprint enter reviewed correction, not silent overwrite |
| Source-to-activity link | same-owner FK `(activity_id,user_id)` | Source row cannot point to a different athlete's activity; binding changes require auditable server writer |
| Metric definition | `(metric_code, definition_version)` | Stable definitions, explicit sport applicability/units and allowed measurement kinds; old observations keep original version |
| Metric fact / selection | multiple source observations permitted; one reviewed *selected* fact per activity/metric/segment at a revision | Never unique only on `(activity_id, metric_code)` if it would erase conflicting evidence; selected value must reference provenance |
| Training terminal finish | immutable `(user_id,session_instance_id,finish_event_id)`; exact retry action/payload fingerprint | Finishing transaction commits terminal event and private outbox operation together; concurrent finish cannot emit two distinct terminal events |
| Private outbox | unique `(user_id, finish_event_id)` and immutable event/owner/session source references | Claimed worker may retry after a crash; acknowledgement occurs only after the canonical writer returns an actual ID |
| Completed Activity write receipt | unique `(user_id,training_session_instance_id)` when present; exact source retry keyed separately | Same finish retried after response loss returns same canonical activity ID, never a second one |
| Confirmed gear assignment | one current association per `(user_id, completed_activity_id)` where relevant, bound to a same-owner gear ID | Shoe/bike editing replaces attribution, not additive mileage; deleted activity no longer contributes; manual baseline retained |
| Owner-scoped source candidate snapshot | stable query generation, exact source identity scope, bounded relevant overlap window, explicit complete pagination | Partial results cannot claim `new_activity_candidate` or a verified cross-provider match |

**Constraint distinction:** These are recommended target invariants, not exact executable index declarations. Composite same-owner foreign keys require supporting unique keys on the referenced tables. For nullable Training links and multiple source kinds, finalize the PostgreSQL index predicate and source scope during owner review. Public RLS is mandatory on every new exposed table, even if client writes are revoked.

### First safe backend release slice, after approval

1. Review and approve canonical identity, source key and Training handoff relationships across ALL-222/243/246, including the open Training day-state mismatch. Avoid introducing a Completed Activity writer before its exact consuming identity and transaction are fixed.
2. Generate reviewed versioned migrations in the existing repository workflow. **First migration:** canonical parent, strict source identity, registry definitions and least-privilege owner SELECT; no provider workers, route buckets or UI claims. **Second migration:** typed facts, segment/strength/series metadata and owner-bound readers as their domain owners sign off. **Third:** transactional Training finish/outbox plus idempotent Completed Activity consumer and reconciliation receipts. Order may change with dependencies but never create a second writer.
3. Verify on an isolated database replay with at least two distinct athlete identities, a signed-out role, foreign-owner key probes and nested cross-owner FKs. PostgreSQL RLS must explicitly restrict `user_id=(select auth.uid())` for owner reads; authenticated role alone is insufficient.
4. Private outbox/idempotency tables have RLS enabled and no direct `anon` or `authenticated` access. Owner-checked RPCs require explicit `p_expected_user_id` verification before idempotency lookup; service-only operations must not become generally executable. Test stale-session/account-existence behavior consistent with current V2 auth deletion controls.
5. Exercise parallel finish/duplicate source inserts in separate database sessions, worker interruption before/after write, retry after lost acknowledgment, altered-fingerprint retry, same-source revision correction, and unrelated workouts nearby in time. **No release** if any duplicate or cross-owner leak occurs.
6. Run full TypeScript/Expo/device tests with actual activity read -> Overview/Details/Coach, private route access restrictions, custom layout save, post-workout shoe attribution and deletion. Historical imports, Coach, Progress, Community and account deletion must all consume/reference the same canonical ID, not shadow rows.

### Source-only implementations available for that release

- `completedActivityHandoffContract.ts` — immutable finish identity and truthful pending/ready receipt
- `completedActivitySourceReconciliation.ts` — conservative source-key, certified-session and conflict decisions
- `completedActivitySourceCandidates.ts` — **requires complete owner-certified candidate read** before claiming no matching source
- `completedActivityOwnerRead.ts` — validates owner/activity identity, metric/source registry versions and runtime quality/provenance
- `completedActivityGearMileage.ts` — read-only mileage derived from unique confirmed gear assignments; manually entered gear mileage stays baseline, and displayed total corrections subtract already credited activity distance
- `completedActivityDetailProjection.ts`, `completedActivityScreenModel.ts` and `CompletedActivityScreenContent.tsx` — V1-standard source-backed Overview/Details/Coach, including pinned additional Overview metrics

**Remaining blocking approval:** Owner decision/review of these database keys, persistent source deduplication and transactional handoff; table/migration creation, RLS replay and live mobile integration have **not** occurred.


## 13. Final physical-schema decision record — source, metrics, reconciliation (2026-11-11)

**Review decision for ALL-222/243/246; not live schema approval or provider certification.** This specializes the existing canonical Completed Activity owner, immutable source/provenance model and sport metric registry. It does not create alternative workout/metric stores.

### Canonical activity and source identity

1. One **physical workout** has one stable \`public.v2_completed_activities.id\` within the athlete's account. Manual and imported activities can exist without a Training execution; a finished Training session can produce **at most one** linked canonical activity. A sport transition inside a certified triathlon/brick is an ordered segment, not necessarily another parent activity. Activity kind and sport subtype are distinct.
2. The first-class external source identity is \`(user_id, provider, source_kind, source_record_id)\` for currently certified providers/identifiers. The \`source_record_id\` must be the provider's **stable namespace-qualified identifier** under the certified connector contract; a device-local ID without sufficiently stable provider/device/account namespace is **not eligible** for automatic dedupe. Retain raw original provider ID formatting and explicit certified \`source_device_ref\` separately when supplied. Never merge cross-athlete records. A given external source identity is attached to at most one canonical activity.
3. Exact retries are idempotent only when source identity, payload fingerprint, recorded provider revision/quality and capture timestamp (when present) agree. A changed revision, hash, timestamp, device provenance or source attachment identity is a **correction/review event**, not an automatically verified duplicate. The existing candidate source helper now checks capture-time equality; final device namespace/revision semantics still require provider-specific approval.
4. Multiple distinct sources can be attached to an existing activity only after an owner-scoped, **complete** candidate search and reliable common physical-event evidence. The strongest evidence is an exact server-certified Training session ID. Matching sport, distance, start times, overlapping windows or similar route **alone** are not proof; competing plausible targets yield \`needs_review\` without a guessed merge. Separate workouts close in time remain separate.
5. An authorized correction/merge preserves original source provenance and stable activity ID. Reconciliation is serialized and recorded with expected activity version, actor/source authority, event ID and audit trail. Unverified source metrics cannot become leaderboards/achievements/PRs merely by attaching a \`trusted\` label from a client.

### Versioned metric registry: conservative first release

- The **single** canonical registry is \`public.v2_activity_metric_definitions(metric_code,definition_version)\`; the first release uses the already implemented **constrained sport-scope array**, not a second normalized registry. The allowed sport family and measurement-kind enums are SQL-checked; review the definition's complete applicability and the source protocol before publishing. A future normalized applicability relation, if needed for governance, must extend this same owner without replacing identity or silently changing old semantics.
- A metric definition has an unambiguous canonical unit, typed \`numeric/text/boolean\` scalar value kind, allowed source measurement classes, sport scope, quality/visibility rules and exact comparability class. Missing data means **no value row**, while measured zero is an explicit value. Do not default \`null\` to zero or convert machine-native levels/steps/strength loads into unrelated running/cycling units.
- **Definition versions are immutable when published or retired.** Changes in unit, computation, protocol, comparability or applicability publish another version. The database can retain the original source's definition version forever; no retroactive mutation when athlete zones/FTP/CSS or provider calculations change. Registry publication belongs to controlled migration/operator process, never the athlete, Coach text or import payload.
- Existing \`v2_activity_metric_values\` owns source-backed scalar facts with a typed value, exact source FK, measurement kind, quality and fingerprint. Segment-specific statistics belong to the canonical segment/strength hierarchy with source binding; route and time-series blobs belong to private Storage **only after** bucket/retention/export/deletion approval. A single source observation is not a selected performance fact just because it is present.
- Metric selection must be explicitly deterministic by metric definition, source capability and data coverage; no generic first-source-wins, averaging competing devices, or source-labeled \`trusted\` shortcut. Contradictory observations remain distinct/unresolved. Store calculation authority, version and input fingerprint for derived/estimated results, and never treat estimates as measured values.
- ALL-243's **complete Details tab requirement remains binding**: every genuinely available approved sport statistic needs provenance and a sport-specific Details position; the Overview projection and pin customization read the same metric registry. This document does not shrink the full sport-by-sport audit to the short examples here.

### Trusted handoff, eventual consistency and privacy

- Training's finish transition, terminal execution event and outbox envelope are **one database transaction**. The worker's \`(user_id, session_instance_id)\` link is idempotent: one pending/review activity and one source reconciliation, even after crash, retry or lost acknowledgement. Completion is initially \`needs_review\` until genuine source coverage; never claim verified \`completed\` merely because the finish button was tapped.
- Outbox worker failure returns a durable **pending** status and allows reconciliation. Do not dispatch direct service-only writes from a device or grant clients access to private source/action tables. Source acquisition/certification and user account/session checks are owned by the authorized ingestion service.
- Owner-private Health, route and precise-location data remain owner-scoped. Public Community/EventHub only receives explicit authorized share projections, never the underlying private sensor payload or exact unshared location.
- The current account export/deletion functions are an **existing canonical owner**, not optional infrastructure. New activity/source/segment/metric records must remain within their direct owner-FK cascade and export coverage. A real Storage bucket cannot be enabled without corresponding object-byte export and retention/delete lifecycle. Preserve conservative fail-closed behavior until that flow is complete.

### Unresolved provider and physical release signatures

This decision locks the **proposed ownership/key/version/quality policy**; it does **not** certify a particular Apple Watch/HealthKit device identifier namespace, exact Garmin/COROS provider mapping, approved sport-wide metric definitions/units, strength exercise IDs, source calibration, route bucket, retention limit or a real service worker. Those require owner-specific evidence and compatibility reviews before migrations and grants. The all-stats fixture matrix in ALL-243, existing account export mobile parser, two-account RLS and concurrency tests, source/provider correction replay, and installed-device capture are release blockers, not documentation-only checkboxes.

**Status:** schema review decision recorded in the canonical ERD. No deployment approval, production DDL or live source verification implied.


## 14. Locked V1 sport-family compatibility — schema review (2026-11-11)

The original locked V1 Completed Activity decisions at \`ALL-IN/docs/decisions/2026-10-29-sport-specific-completed-activity-screens.md\` and \`2026-10-29-customizable-analytics-layouts.md\` are binding product scope, not automatically verified provider telemetry. The physical V2 candidate used to omit **walking**, **HIIT**, and **multisport** from its sport CHECK enums despite V2's own presentation adapter and the locked V1 screens.

The existing SQL candidate has now been extended (same owner, no new tables) so the canonical sport families for Training prescriptions, Completed Activity parents, semantic segments and the metric registry share:

\`running, walking, cycling, swimming, strength, hiking, rucking, rowing, elliptical, stair, yoga, mobility, hiit, multisport, other\`.

Sport subtypes (e.g. road/trail/treadmill, indoor trainer/outdoor ride, pool/open-water, triathlon/brick) are **not** alternative parent sport identities. The presentation adapter maps \`hiit\` to locked V1 HIIT and \`multisport\` to locked V1 Hybrid / Multisport. The separate source-scoped sport leg of a multisport activity is the authority for a *leg-specific* metric; the parent \`multisport\` is not allowed to suppress cycling power, running pace, or swim stroke facts from its real legs. The candidate segment projection now reads the nearest recorded owner-bound segment ancestor sport, with a contradictory sport rejected for a non-multisport parent.

The existing Postgres identity replay adds valid walking/HIIT/multisport parent rows; the segment replay adds a nested cycling interval within a multisport parent, preserving sourced watts; the existing mobile presentation test covers HIIT/Hybrid subtype routing. **No fresh test run has been verified**.

**Still required for complete schema signoff:** reconcile all approved V1 screen-specific metric definitions and their source/unit/protocol into the single metric registry; add a **reviewed segment-scalar ingest command** that binds source identity, segment sport and immutable definition version (the current candidate scalar append helper accepts only an activity-global metric, while the segment projection already supports segment rows). Also review taxonomy/profile behavior for rowing and other currently honest generic fallbacks, and ensure any sport-vs-subtype combinations cannot be misclassified by provider imports. No unsupported metric or new family is auto-published by expanding the enum.

This is a review-stage compatibility correction only; it does not constitute production migration or final source/provider approval.


## 15. V1 sport-by-sport metric capability signoff matrix — release checklist (2026-11-11)

**Authority:** locked V1 \`docs/decisions/2026-10-29-sport-specific-completed-activity-screens.md\`, V2 \`v1CompletedActivityBaseline.ts\`, ALL-243's complete-Details requirement, and versioned \`v2_activity_metric_definitions\`. The rows below define **coverage/representation obligations**, NOT measurements the app currently receives, published metric definitions, manufacturer/provider certifications or proof of deployed code.

| Canonical parent / subtype | Required capability families for Details whenever genuinely sourced | Special ownership, units or prohibited inference |
|---|---|---|
| \`running\` / road, trail, track | elapsed/moving/paused time; distance; pace/speed trend and splits; heart-rate average/max/zones incl. Zone 2; cadence; stride length; ground-contact time; vertical oscillation; source-backed running power; elevation gain/loss/profile; route/terrain/temperature where sourced; energy, effort, structured-target execution | distance **m**, duration **s**, HR **bpm**, pace **s/km** as normalized display calculation with source trace; dynamics require a capable source. Trail/road is **subtype**, not fabricated GPS proof |
| \`running\` / treadmill | all applicable running and HR/split facts; machine-reported speed/distance; incline and authored interval targets vs actual; calibration/correction history | machine incline unit must be explicit (often %); no GPS map without a real GPS source; corrected distance is not machine-measured |
| \`walking\` | elapsed/moving time, distance, pace, steps, cadence, HR/zones, route/elevation if measured, energy, effort | steps **count**, no inferred workout intensity/race performance |
| \`hiking\` | time, distance, ascent/descent/elevation profile and extrema, route/navigation, secondary pace/splits, HR, energy, effort | ascent/descent **m**; verified course/route only, no fabricated vertical |
| \`rucking\` | hiking/walking capabilities plus recorded pack weight and authored-versus-recorded pack-load context | load **kg** after explicit unit conversion; never infer a load or a pack-adjusted metric without source evidence |
| \`cycling\` / outdoor | elapsed/moving time, distance/speed, power/normalized/weighted power, power zones/FTP-relative intensity only when calibrated, cadence, HR zones, route/elevation, laps, energy, effort | power **W**, cadence **rpm**, speed **m/s** canonical; FTP is a separately sourced versioned athlete parameter, not assumed |
| \`cycling\` / trainer | authored interval graph and execution, power/target zones, cadence, HR, mode (ERG/resistance/simulation), trainer/power-source continuity, time in target ranges, challenge verification where applicable | no GPS map; ranked challenge scores require separately verified eligibility/locked scoring rules |
| \`swimming\` / pool | length and total distance, session/set/lap/length hierarchy, rest, pace/100, stroke count/rate, SWOLF if actually measured, HR where reliable, effort | pool length **m**, pace **s/100m**, SWOLF requires an eligible source and clear method; no open-water GPS |
| \`swimming\` / open water | GPS route if actually captured, distance/time, pace/100, splits, HR, stroke, environmental conditions where supported | never synthesize pool lengths/laps; preserve GPS quality |
| \`strength\` | exercise IDs, each actual set/reps/load, RPE/RIR, rest, substitutions, validated volume and comparable PRs, session timing, effort | reps **count**, load **kg** normalized with original units preserved; bodyweight/assisted semantics must be typed, no guessed 1RM |
| \`elliptical\` | time, machine distance (only when reported), cadence/stride rate, resistance, ramp, HR/zones and trends, energy, effort | machine level/ramp must preserve equipment protocol; no fake running mileage |
| \`stair\` | steps/floors, step rate, time, machine level/resistance, HR/zones/trends, energy, effort | count **steps/floors**, time **s**, no inferred distance or climbing elevation |
| \`yoga\`, \`mobility\` | duration, authored blocks/poses/timing if recorded, optional HR, notes and effort | deliberately sparse; no fabricated recovery scores |
| \`hiit\` | time, HR average/max and zones if measured, interval/block structure and authored targets when available, effort, energy | HIIT retains its own locked presentation and requires actual source/author intent |
| \`multisport\` / triathlon, duathlon, brick | ordered legs with each leg's **own** sport metric families, transitions, total elapsed time, per-leg source/device handoffs, overall completion | ONE canonical parent, explicit \`multisport_leg\` and \`transition\` segments; per-leg source sport supersedes parent only for that leg; no duplicate finished parent activities |
| \`rowing\`, \`other\` | genuinely source-backed time/distance, HR, power/cadence etc. as supported | current V2 rowing/other presentation is explicitly generic fallback; dedicated screen and device definitions remain unapproved, never invent a sport-specific metric |

### Canonical metric registry representation decision

- **Scalar**: the existing \`v2_activity_metric_definitions(metric_code,definition_version)\` and sourced \`v2_activity_metric_values\` are the sole persisted registry/fact pair. Normalize *units* at a trusted adapter while preserving provider units, transformation revision and original source identity. A display label such as "Zone 2" is not a sensor fact absent source/zone-definition provenance.
- **Repeated/structured**: laps, HR-zone distributions, swim lengths/strokes/rest, exercise sets, trainer intervals, multisport legs/transitions, source discontinuities and time-series/map shape belong to the existing segment/strength/evidence graph—not a single arbitrary JSON metric fact. Publish typed source/segment-backed writer rules before promising these analytics in the UI.
- **Derived**: pace, normalized/weighted power, FTP-relative work, volume, SWOLF, challenge score, predicted PR or any estimated quantity requires its own declared algorithm version, validated inputs and comparability policy. Missing/partial source does not turn into zero or a confident derived statistic. Ultra PR prediction remains excluded by existing product policy.
- **Privacy**: HR/Health, location routes, home-adjacent GPS, athlete training metadata and wearable identity are private. Source evidence may be reused in Community/EventHub only via explicitly approved redacted projections.
- **Presentation**: Details shows every **actually available and approved** metric in its sport-specific section; Overview uses a small recommended set plus per-screen user pins/order/hide where safe. UI preference never mutates facts or metric registry.

### Per-metric publication checklist (must all be true)

Each metric/version must have a unique semantic key; compatible sport/subtypes; canonical value kind and unit plus raw source unit; raw vs derived authority; provider/device capability; sample coverage/quality threshold; comparison equivalence and zone/baseline versions where relevant; calculation/version/input fingerprint; privacy and allowed share level; Details placement and defaults; absent/zero handling; controlled definition migration/retirement; and positive/negative single-sport, multisport, two-user and contradictory-provider fixtures. A provider name or copied V1 display label alone meets **none** of the capture/eligibility evidence requirements.

**Release blocker:** This matrix is a **complete family-level checklist**, not a published exhaustive \`metric_code\` dictionary. The per-code signed registry and verified provider capability matrix remain separate review work. No speculative metric rows were inserted and no new live provider data was claimed.


## 16. Segment-scalar write/read release candidate — 2026-11-11

Extended the **existing** physical candidates with a trusted-only \`allin_private.v2_activity_append_segment_scalar_candidate\` in \`V2-COMPLETED-ACTIVITY-SEGMENTS-CANDIDATE.sql\`, using the **same** \`v2_activity_metric_values\` store and definition-version identity as activity-global metrics. The original scalar metric table now reserves nullable \`segment_id\` at base creation; \`NULL\` means an activity-global fact. The segment phase activates its same-owner FK and the \`NULLS NOT DISTINCT\` uniqueness contract; it **does not add a duplicate column or second fact table**. The original global scalar writer filters \`segment_id IS NULL\` so a source's whole-session power and its individual leg power never collide on replay.

The segment writer serializes by owner, requires a same-owner non-invalidated activity, matching activity source and exact stored source hash, existing same-owner segment, published typed metric definition, source-authorized measurement kind, correct declared value type, and sport applicability to the nearest explicit owner-bound segment/leg sport. An exact retry returns the original metric; a changed value or ID for the same source/segment/metric-definition is a conflict. Independent same-owner sources may contribute observations to the same segment for source conflict reconciliation. It never promotes an unsupported sensor, value, PR or competition score to verified; it has no client \`EXECUTE\` grant.

Expanded the existing disposable \`test-v2-completed-segments-postgres.psql\` to exercise exact replay, changing values/hash, foreign-owner denial, missing-vs-zero, nested leg sport, two sources disagreeing on power while independently agreeing on cadence, and global-versus-leg fact isolation. Existing source reconciliation client certification now rejects foreign-athlete candidates **before** unsupported-provider/pagination fallback; cross-athlete data is never treated as an ordinary review state.

**Important independent remaining gates:** the SQL writer is a private **candidate**, not an authenticated provider endpoint; actual source-to-segment observation certification is not implemented. The metric/segment ancestry currently has a bounded recursive read, but no released database trigger proving acyclic parent graphs (also needed). The full provider revision, observed-device namespace, unit-conversion/version and published metric dictionary require their respective owners. Accepted activity-global and segment facts must be assessed together under a single source-quality reconciliation policy before being used for public comparisons. Clean PostgreSQL/Node CI runs at these commits, full 18+ live-migration replay, service-role security, and installed device ingestion remain unverified. **No production DDL, client grants or device integration in this slice.**
