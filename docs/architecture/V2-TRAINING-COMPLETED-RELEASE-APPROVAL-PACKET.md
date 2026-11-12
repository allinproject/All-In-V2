# ALL-222 / ALL-243 / ALL-246 — Training + Completed Activity release approval packet

**Status:** REVIEW ONLY — migration sequencing and owner acceptance checklist. Not approval, migration DDL, a production deploy, or an activated app writer.  
**Repository / branch:** `allinproject/All-In-V2` / `integration/v2-foundation`. Never modify `main` or V1 from this packet.  
**Hosted V2:** `xarhuczrtzuiljmtdaeu`; current applied foundation versions through `20261111134456` (18 at last authoritative comparison). Refresh before release.  
**Canonical owners:** ALL-222 domain/security; ALL-246 planned revision/calendar/session; ALL-243 completed activity/source/metric; ALL-251 account export/deletion; ALL-239 Goals; ALL-244 EventHub; ALL-234 race/course certification.

## 1. Verified engineering evidence, not production acceptance

| Gate | Verification | Scope and limitation |
| --- | --- | --- |
| Exact 18-file historical migration provenance | `scripts/check-v2-applied-migration-integrity.mjs`; repository SQL compared with the hosted migration ledger | Does not validate new DDL or authorize deployment |
| Clean local Supabase 18-migration bootstrap | [run 43131586440](https://github.com/allinproject/All-In-V2/actions/runs/43131586440) — SUCCESS | Local Auth/Storage/cron only |
| Canonical identity/calendar after real foundation | [run 43132457226](https://github.com/allinproject/All-In-V2/actions/runs/43132457226) — SUCCESS | Review-only DDL |
| Full proposed Training/Activity graph after real foundation | [run 43133046823](https://github.com/allinproject/All-In-V2/actions/runs/43133046823) — SUCCESS | Schema compatibility, not certified Goal/Event FK or device data |
| Canonical export/owner-deletion FK review | [run 43133515346](https://github.com/allinproject/All-In-V2/actions/runs/43133515346) — SUCCESS | Existing ALL-251 export candidate, not real downloadable archive |
| Synthetic populated two-owner Auth deletion | [run 43133938802](https://github.com/allinproject/All-In-V2/actions/runs/43133938802) — SUCCESS | Test rows rolled back; no real user deletion |
| Complete candidate catalog RLS and actual local Supabase anon/authenticated ACL probes | [run 43134562411](https://github.com/allinproject/All-In-V2/actions/runs/43134562411) — SUCCESS | Existing proposed API functions intentionally remain uncallable by clients |
| Reduced Postgres17 plan/source/metric/concurrency suites | Existing `.github/workflows/v2-training-completed-postgres.yml` | Separate candidate integration test; does not substitute for installed-device acceptance |
| **Latest complete 18-migration + 30-candidate compatibility acceptance** | **[run 43138298262](https://github.com/allinproject/All-In-V2/actions/runs/43138298262), `f209ceb` — ALL THREE JOBS PASSED** | Local CLI v2.122.1 clean replay of all 18, foundation RLS/export/deletion/cron PASS; 30 staged review-only candidates/14 wrappers, 6 staging tests PASS, DDL/ACL candidate overlay PASS, ROLLBACK restores base export function and removes candidate schema; PostgreSQL 17 real-role, writer, concurrency and sport-source suites PASS. **Not hosted migration approval.** |

All runs are local/disposable or CI review-only. **No hosted Training or Completed Activity DDL was deployed by these tests.**

**2026-11-11 engineering gate decision:** the isolated full-history replay is **VALIDATED / closed as a compatibility prerequisite**. Do not keep this specific test marked pending or introduce another replay harness. The production-approval checkboxes in §4 remain open until the domain owners sign off exact source-backed sport metrics, Goal/Event race identity, complete ALL-251 Storage export/deletion and installed-device behavior. Passing the candidate overlay **does not turn these review-only SQL files into approved, versioned migrations**, nor grant client access. On later SQL changes, require a new green workflow run at the changed commit before using this evidence for a release cut.

## 2. Dependency-ordered review units — one canonical graph

Use the **existing** reviewed SQL candidates in `docs/architecture/sql/` as the inputs. These are NOT versioned migrations and must not be copied into `supabase/migrations/` or activated without sign-off. Each unit lists all its prerequisites; an approved release may split physical transactions more finely, but must not expose a partially guarded write surface.

1. **Owner identities:** `V2-TRAINING-COMPLETED-IDENTITY-OWNER-CANDIDATE.sql` — single canonical Training execution, Completed Activity and source identities. Requires V2 `auth.users` and owner FKs.
2. **Training plan/revision/calendar:** `V2-TRAINING-PLAN-CALENDAR-OWNER-CANDIDATE.sql`; `V2-TRAINING-IMMUTABLE-REVISION-GUARD-CANDIDATE.sql`; `V2-TRAINING-PLAN-ACCEPTANCE-WRITER-CANDIDATE.sql` — immutable accepted revisions, selected inclusive date window, timezone consistency and serialized acceptance. No Coach direct plan writes.
3. **Execution and owner gateway:** `V2-TRAINING-SESSION-LIFECYCLE-WRITER-CANDIDATE.sql`; `V2-TRAINING-AUTH-OWNER-GATEWAY-CANDIDATE.sql`; `V2-TRAINING-START-PLANNED-WORKOUT-CANDIDATE.sql` — stable accepted-session identity, Auth/session generation, replay receipts, CAS and single live workout.
4. **Completed Activity provenance and structured facts:** `V2-COMPLETED-ACTIVITY-SOURCE-WRITER-CANDIDATE.sql`; `V2-COMPLETED-ACTIVITY-SCALAR-METRICS-CANDIDATE.sql`; `V2-COMPLETED-ACTIVITY-METRIC-DEFINITION-GUARD-CANDIDATE.sql`; `V2-COMPLETED-ACTIVITY-SEGMENTS-CANDIDATE.sql`; `V2-COMPLETED-ACTIVITY-STRENGTH-SETS-CANDIDATE.sql`; `V2-COMPLETED-ACTIVITY-SCALAR-READ-CANDIDATE.sql`; `V2-COMPLETED-ACTIVITY-EVIDENCE-OBJECTS-CANDIDATE.sql`. Every measurement needs an actual permitted source; lack of data never means zero or a fabricated estimate.
5. **Finish-to-activity handoff:** `V2-TRAINING-COMPLETION-ACK-CANDIDATE.sql`; `V2-TRAINING-ACTIVITY-OUTBOX-WRITER-CANDIDATE.sql` — exact one physical activity, idempotent receipt, rejection of wrong sport/owner/source, no fabricated measured facts. Approve which trusted worker owns delivery/retry before granting it execution.
6. **Optional competition owner:** `V2-INDOOR-WEEKLY-COMPETITION-OWNER-CANDIDATE.sql`; `V2-INDOOR-WEEKLY-SCORE-V1-CANDIDATE.sql` — requires separate ALL-253 sport eligibility and award policy. Cannot make source-unverified activities eligible.
7. **Same-release account lifecycle integration:** `V2-TRAINING-ACTIVITY-OWNER-CASCADE-REVIEW-CANDIDATE.sql`; `V2-TRAINING-ACCOUNT-DELETION-HISTORY-GUARD-CANDIDATE.sql`; `V2-TRAINING-DIRECT-AUTH-CASCADE-REVIEW-CANDIDATE.sql`; `V2-TRAINING-ACCOUNT-EXPORT-FRAGMENT-CANDIDATE.sql`; `V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql`. Extend the **existing** ALL-251 snapshot and deletion preflight; do not launch a parallel export API. Private series/route Storage object bytes need a separately approved secure export and cleanup contract.
8. **Only after least-privilege approval:** reviewed owner reads/gateway grants, trusted worker/Edge credentials, generated database types, mobile readers and exact end-to-end Training/Activity lifecycle. Keep unapproved public/client permissions revoked by default.

## 3. Required cross-domain owner decision, not a Training-invented event store

The Goals owner **ALL-239** must publish: stable typed `goalId`, owner key, immutable goal revision/version, optional target-window semantics, independently chosen priority (multiple primary goals permitted), explicit user-approved link to a Training plan or revision, and typed metric/exercise references where applicable. An undated qualitative intention must be valid without manufacturing a calendar or numeric score.

The EventHub owner **ALL-244** (with race/course verification **ALL-234**) must publish: stable all-sport `eventId`, event version, organizer/date/timezone/sport verification state, owner-bound event participation status distinct from EventHub membership, course version where a course exists, and the correct identity/version update rule for postponements and edits. A URL, display name, group join or Coach guess is not a verified event.

Training's existing plan/revision/session IDs must be linked by **typed same-owner, version-consistent FKs or a conservative read gate** to the actual approved Goal/Event owner tables once published. Do not create an alternate event registry, polymorphic free-text FK, assumed participation, or force one event per date. For two events on the same day, preserve both unique event identities and require conflict review.

**Scope gate:** General/non-race Training can be reviewed separately from certified race-linked plan activation. No claim that race plans are production-certified while Event/Goal identities and source versions are absent. Do not make ALL-222 <-> ALL-239/244 into cyclic Linear blockers.

### Read-only cross-owner validation now implemented (not published backend)

The existing Training season preview now has a separate, test-covered, **source-only** approval gate at `apps/mobile-v2/src/features/training/canonicalEventGoalApprovalGate.ts`. It accepts only complete, authenticated owner-session snapshots from the actual Goal and Event owners, together with the canonical Training event-binding snapshot. It rejects incorrect owner/generation, pagination, unverified Event identity, group-only EventHub membership as registration, missing accepted Goal→Event linkage and stale Event version/timezone/session references. The Training calendar snapshots must share the same Training owner revision; **independent Goals and EventHub snapshot version strings are not assumed equal**. The exact event record version/date/timezone/sport and Training's saved reference must match. An undated general goal may coexist without a fabricated event.

This is a **fail-closed read/preflight boundary**, not proof that these owner snapshots are available in Supabase or that database FKs/permissions are approved. The existing preview remains non-mutating; release activation must wire actual owner services and uphold freshness and version checks again in the transactional Training writer. Test registration lives in the existing `apps/mobile-v2/package.json` Training logic suite. An EventHub URL resolver or group membership receipt is not a substitute for authoritative Event/Goal evidence.

### ALL-239 canonical Goal identity candidate (review-only)

The existing ALL-239 physical ERD now has a first concrete proposal,
`docs/architecture/sql/V2-GOALS-IDENTITY-REVISION-OWNER-CANDIDATE.sql`,
and follow-on immutable revision guard
`docs/architecture/sql/V2-GOALS-REVISION-HISTORY-GUARD-CANDIDATE.sql`.
They define **Goals-owned** stable identity and same-owner revision keys,
allow independent accepted primary goals and undated intentions, and do not
store any Training session or EventHub group. A local Supabase rollback-only
fixture tests foreign owner rejection, revision supersession and two-athlete
Auth-deletion isolation. This first candidate does not yet establish an owner
writer, published authenticated read API, user-approved target evidence, or the
authoritative Event FK. Do not mistake a green local replay for schema approval.

### ALL-239 durable approval consent gate

The existing Goals owner has a **review-only** end-to-end proposed
approval chain: canonical accepted-revision identity, immutable behavior
children, a private live-session-bound writer, a private bounded Goal
snapshot reader, an immutable ten-minute athlete review ledger, a
server-generated SHA-256 of the exact Goal/revision/behavior preview,
and a private issuer and commit gateway that rechecks the same content
inside its database transaction. The source-only Edge Auth adapter also
passes the exact durable review ID. See
`docs/architecture/V2-GOALS-PHYSICAL-ERD-AND-SECURITY-PROPOSAL.md`.

None of these files is an approved migration or app-delivered UI.
**Goals cannot be considered complete until the mobile athlete actually
sees and explicitly confirms the exact server-provided preview**, and
the trusted authenticated server can persist, revoke and use that consent
without granting direct client access. Race/event FKs and certified
participation remain with ALL-244/234; Goals cannot fabricate them.
Any Goal change after preview must invalidate consent rather than
silently change a plan. Revalidate on physical installed devices.

### ALL-244 EventHub physical owner compatibility verified

The **existing ALL-244 EventHub owner**, not Training, now proposes
`V2-EVENTHUB-IDENTITY-MEMBERSHIP-PARTICIPATION-CANDIDATE.sql`,
`V2-EVENTHUB-OWNER-EVENT-PLAN-READER-CANDIDATE.sql`,
`V2-EVENTHUB-MEMBERSHIP-WRITER-CANDIDATE.sql` and
`V2-EVENTHUB-EVENT-VERSION-GUARD-CANDIDATE.sql`.
One canonical organizer event ID/version supports all sports and
reviewed URL aliases. Group membership is **not** registration;
participation is independent, source-attributed and owner-bound.
A verified organizer cancellation/postponement changes event version
and invalidates stale race-linked Training certification, never
silently changes an accepted Training plan.

[Local Supabase full replay #43192676260](https://github.com/allinproject/All-In-V2/actions/runs/43192676260)
**SUCCESS** for V2 foundation, Goals, EventHub identity/reader/writer/version
and the *existing* Community privacy candidate. An additional two-session
first-join race is pending independent acceptance. See
`docs/architecture/V2-EVENTHUB-CANONICAL-OWNER-REVIEW.md`.
**No live EventHub migration, public group route, verified URL resolver,
actual event registration, trusted service grant or installed app signoff
exists.** Require those owner approvals before physically binding
`eventId/eventVersion` into Training revisions.

## 4. Release cut acceptance (all must pass before hosted DDL)

- [ ] ALL-222/243/246 sign off source identity, canonical aggregate FKs, plan revision lifecycle, metric registry and exact source/quality model.
- [ ] ALL-239/244/234 publish authoritative Goal/Event/course/participation identity and version contracts. Review dual-event and mixed sport collision scenarios.
- [ ] ALL-251 verifies same-release account deletion, Storage cleanup, export fragment/bytes and installed mobile export-version compatibility.
- [ ] Review ordered, **versioned** migrations against refreshed hosted migration history; include rollback and forward-fix strategy; avoid temporary unguarded grants; never alter already-applied files.
- [ ] Replay the approved final migrations, not review-only candidate files, against a clean disposable Supabase stack; assert RLS, all seven table privileges, all function grants, real roles, cross-owner FKs, concurrency, retries and account export/deletion.
- [ ] Validate real provider/device source ingestion, data provenance, duplicate correction and offline/reconnect; never claim measured facts from candidate-only SQL.
- [ ] Validate installed iOS/Android Training calendar → start/finish → Completed Activity Overview/Details/Coach, protected owner reads, account switching, multi-event plans and profile export/deletion. Verify build/type generation.
- [ ] Obtain explicit authorized release approval before hosted deployment; verify post-deploy grants/schemas and keep unapproved workers/features OFF.

## 4A. Canonical Completed Activity owner-reader DTO and session expiry acceptance

**Current gap, not an approved public API:** the review-only `public.v2_completed_activity_detail_candidate` returns an activity summary with `activityId`, sources without their raw provider record IDs, `activityMetrics` containing numeric typed values, segments, and strength-set facts. The existing mobile `completedActivityOwnerRead.ts` deliberately consumes a **different, source-certified presentation DTO**: `id/ownerId/version`, sport/subtype, a stable opaque source key per measurement, versioned published definitions, source/metric confidence, and an authorized display value + real unit. Do **not** connect those two shapes directly, fabricate a `displayValue`, infer missing route/series payloads from mere count, or create another workout store. This adapter must be owned and reviewed under ALL-243/222.

Acceptance for the single owner-backed integration:
- Authenticate and re-check the actual owner/session before any private owner projection, including `auth.sessions.not_after` when present. Do not rely solely on an extant row or a stale JWT claim; session expiry and account change must fail closed.
- Return a bounded, complete, authenticated *one activity* snapshot with exact owner, canonical ID/revision, approved sport/subtype and source-local opaque IDs—not private provider record IDs or Storage paths.
- Resolve multiple published versions of the **same metric code** within one activity or segment as `conflicting_versions` in the existing `unresolvedMetrics`, without emitting two screen metrics or silently picking whichever was first. The review-only scalar/segment candidate and local PG regression fixtures now encode this rule; a green replay at their exact commit is **still required**.
- Translate typed numeric/text/boolean canonical values with explicitly approved unit formatters/version, provenance and source/measurement quality. A measured zero is real; missing/low-quality data is not zero. The client must not treat `unresolvedMetrics`, private counts, or source labels as authoritatively displayed facts.
- Include immutable canonical snapshot revision, semantic segment IDs and authorized/private routes/series descriptors only after the approved secure reader exists. Never expose raw object paths, provider secrets or HealthKit identifiers.
- Prove anonymous/foreign owner, revoked/expired sessions, exact owner switch, duplicate source, same-code different-version, cross-sport metric, and partial-result failures against real roles plus an installed screen before granting client execution.

**Separation of gates:** Existing 18-foundation/30-candidate replay success at run 43138298262 predates these new SQL candidate changes and does **not** validate them. Only the new commit-matched CI suite can close this review check. The hosted migration, public RPC grant, worker activation, and installed client remain OFF.

## 4B. Current Details source-evidence read hardening (2026-11-12, review only)

The **existing** private owner-detail candidate now returns the canonical activity `ownerId` and `version` alongside `activityId`, enabling the existing mobile owner/revision isolation without guessing owner identity or revision from a device timestamp. It does **not** yet implement the full mobile DTO, user-approved unit formatter, Storage route reader or live RPC grant.

Private `readyPrivateRouteCount` and `readySeriesCount` now require **both** the stored object and its same-owner linked source to have `trusted` or `partial` quality, in addition to `state='ready'`. An unverified/rejected object does not become display-ready because a Storage staging worker marked it ready. The original stored evidence remains private and available to authorized audit/export; this filter is a *read-only display-eligibility boundary*, not deletion.

Structured segment and strength-set Details also include explicit `sourceQuality` resolved by same-owner/source FK. A source-free authored segment exposes `null` for its sensor quality, not guessed `trusted`; existing strength-set `quality` remains separately visible, so later source certification changes cannot be silently hidden.

**Executable review fixtures added** to the existing owner-only PostgreSQL 17 test: one real trusted route still counts; synthetic ready routes/series with unverified object or parent source do not; account/activity/version identity is present; source-backed intervals retain `trusted`; the manual strength set retains `unverified` source quality. These tests are **not yet claimed passing** until a CI run at/after the corresponding commits is inspected. No generated signed URL, bucket grant or public source attestation is part of this release unit.

**Remaining definitive release gate:** review exact domain owner, permitted source-quality policy and service-only adapter against ALL-243 and ALL-251. The private SQL candidate is **not** a production-ready endpoint or versioned migration; preserve all `GRANT EXECUTE` revocations until two-owner RLS, account export/deletion and installed device acceptance pass.

## 4C. Independent measurement and source confidence reconciliation — 2026-11-12

The existing private **global** and **per-segment** scalar projections now combine two independent owner-authorized facts: the metric measurement's quality and its linked source's quality. A metric/source pair is usable only when **both** are `trusted` or `partial`. The result is `partial` whenever **either** is partial, and `trusted` only when **both** are trusted. If either quality is unverified, low-quality or rejected, the metric is withheld and reported as unresolved instead of being promoted or fabricated. This preserves recorded zero and measurement provenance without pretending a partially trusted source is fully certified.

The previous SQL predicate incorrectly classified `trusted` measurement + `partial` source and `partial` measurement + `trusted` source as `unverified`. Its replacement is in the **existing** `V2-COMPLETED-ACTIVITY-SCALAR-READ-CANDIDATE.sql` and `V2-COMPLETED-ACTIVITY-SEGMENT-SCALAR-READ-CANDIDATE.sql`; each of the two evidence CTEs per projection follows the same rule. The existing PostgreSQL 17 fixtures now exercise both mixed-confidence directions, and the current workflow explicitly watches all four changed files.

**Acceptance boundary:** This is review-only source and executable test content, not a released provider-quality policy or live query. A new commit-matched green PostgreSQL workflow run is needed before this change can be described as validated. The caller still must enforce live Auth/owner access; confidence reconciliation grants neither athlete nor worker authorization.

**Unresolved writer/adapter decision:** the existing review-only `v2_activity_append_scalar_candidate` and `v2_activity_append_segment_scalar_candidate` still set `v_quality := v_source.quality` for each appended fact. That guarantees a conservative source-quality baseline but **does not preserve lower per-sample or per-metric quality** from a certified device adapter. The two SQL reader fixtures exercise independently persisted qualities to lock the correct reconciliation behavior; they are not evidence that the current production-intended writers can ingest those combinations. ALL-243 must approve an authenticated, immutable **metric-specific quality** write contract, bounded by the parent source's certification, before calling source-quality ingestion complete. Never silently upgrade poor sensor data because another sample from the same device is trusted. This must extend the existing canonical writer, not create a second ingest ledger.

## 4D. Published scalar response retains independent confidence — 2026-11-12

The existing private activity-global and per-segment scalar projection candidates now return three different, non-redundant quality fields **on source-backed, unambiguous emitted metric facts**:
- `measurementQuality`: conservative aggregation of the metric-specific sample qualities (`partial` if any sample is partial, otherwise `trusted`);
- `sourceQuality`: conservative aggregation of the involved parent source qualities (same rule);
- `quality`: conservative effective quality across **both**, usable only if neither side is `unverified`, `low_quality` or `rejected`.

The existing SQL tests include the two asymmetric real-evidence cases (`trusted` metric + `partial` source, and `partial` metric + `trusted` source), measured zero, conflicts, owner access and mixed published metric-version exclusion. They now also assert the exact quality field values, so the later canonical mobile owner adapter must not collapse independent confidence into a generic source label. No raw provider record IDs, GPS file paths or Storage payloads were introduced.

**Not yet validated:** the changed candidate SQL/fixtures require the next successful PostgreSQL workflow run. The trusted ingest writer still derives metric quality from the parent source by default; retaining truly independent sample-quality data remains an explicit ALL-243 owner decision, not a claim that ingestion is complete. The **authenticated owner Detail RPC-to-mobile adapter remains unimplemented** and cannot simply deserialize SQL's `activityMetrics` object into the existing canonical `CompletedActivityScreenInput`: explicit source identity resolution, versioned units/formatter, published registry definitions and safe structured descriptor conversion are required before app integration.

## 5. Next smallest executable decision

Obtain the **ALL-239 Goals and ALL-244 EventHub canonical owner key/version/participation contracts**, rather than adding a new Training or event schema. Then approve the first release unit and its exact FK/ACL matrix, stage versioned migrations, and rerun the complete local release acceptance. Green candidate SQL tests are necessary but not sufficient.


## ALL-243 — Apple App Attest enrollment inspection and trust writer (2026-11-12)

**Review-only staged implementation; no deployment or public enrollment:**

- `supabase/functions/_shared/appleAppAttestEnrollmentVerifier.ts` pins Apple's official App Attestation Root CA, verifies the embedded X.509 intermediate and leaf signatures, certificate validity, App ID hash, environment, initial counter, credential ID against the P-256 leaf key and certificate challenge nonce. The trust root is not accepted from request data.
- `appleAppAttestEnrollmentServer.ts` requires a live Auth-resolved user/session, one-time server challenge and a **separate trusted Apple signed-receipt verifier** before requesting the private writer. **No receipt verifier has been implemented or connected**, and no public enrollment endpoint has been created. Passing certificate inspection alone is never permission to enroll.
- `appleAppAttestEnrollmentPostgres.ts` is the dedicated transaction adapter. The existing `V2-APPLE-ATTESTED-COMPANION-KEYS-CANDIDATE.sql` has an owner/session-scoped 5-minute challenge, an atomic consumed-challenge + trusted-key insert function, a separate NOLOGIN enroller role and a distinct operator with NOINHERIT/BYPASSRLS. Neither normal clients nor the pairing registrar has the trusted-enrollment privilege.
- `apps/mobile-v2/native/apple-watch/IPhoneAppAttestEnrollment.swift` is staged native code using `DCAppAttestService.generateKey` and `attestKey` with the server's challenge hash. It is not compiled into an iOS/watchOS target and does not provision an Apple trust record.

**Hard release gates (still open):** implement and independently review Apple's signed PKCS#7/CMS receipt trust chain, Apple App ID/public key and five-minute creation-time validation, Apple sandbox/production environment separation, Apple's 2026 validation category and bundle-version extension handling, secure verifier-only key enrolment and revocation, production Team ID/bundle ID/entitlement agreement, hosted authenticated staging and a genuine Apple-issued attestation test on physical iPhone. The native watch proof remains separate: App Attest validates the companion **iPhone app instance**, not an Apple-signed hardware serial or generic Watch attestation. Rate limits, challenges/receipts retention, account export/delete, key loss/reinstall and owner switching must also pass. Explicit production migration and endpoint enablement are not approved.

## 6. ALL-222 release unit 1 — exact owner/security sign-off checklist (2026-11-12)

**Decision state: REVIEW REQUIRED, not permission to merge, create hosted DDL, grant runtime access or activate an app.** Extend the existing Training/Completed candidate SQL and tests, not a second activity or calendar system. This section converts the existing §2 ordering and §4 acceptance gates into a reviewable first unit.

### A. Identity and referential invariants

- [ ] Confirm one immutable `training_session_instance_id` per physical Training execution, one stable `completed_activity_id` per finished activity, and an optional same-owner exact accepted `plan_revision_session_id`. A manual/unplanned activity is valid without a plan FK; a session can be unfinished without an activity.
- [ ] Confirm composite `(id,user_id)` owner keys on Training plan/revision/calendar/session and Completed Activity/source/metric/segment entities, and every cross-aggregate FK includes the *same owner*. Test foreign-owner IDs as well as missing IDs.
- [ ] Confirm immutable accepted plan revision and complete selected-date-through-target-date calendar, including explicit rest, recovery and unavailable days. No silently rewritten accepted plan or duplicated completed workout.
- [ ] Race-linked activation stays separate until ALL-239 Goal revision, ALL-244 Event/participation revision and ALL-234 course versions are approved and owner/version bound. Undated general goals remain valid; two same-day events remain distinct.

### B. Least-privilege execution boundary

| Actor | Training plan/session | Completed Activity and measurements | Private action/ingest ledgers |
| --- | --- | --- | --- |
| `anon` | No owner read or write | No owner read or write | No access |
| `authenticated` | Own bounded approved reader only; no direct INSERT/UPDATE/DELETE | Own bounded approved reader only; no direct canonical writes | No access |
| Coach | Reads authorized context; proposes, never directly applies plan edits | Reads authorized history, never rewrites measurements | No access |
| Verified athlete action gateway | Same-owner live-session proof, approved-preview ID, expected revision and replay guard; narrow canonical writer only | Explicit manual-report writer only when authorized; cannot claim verified device provenance | Transactional helper only |
| Trusted device worker | No direct plan revision; exact approved session link only | Narrow existing source/metric writer with device, session, nonce, source evidence, idempotency and source-specific quality | Narrow transactional helper only |
| Controlled migrations/operator | Audited schema/registry changes under explicit release process | Audited metric-definition seed/revision changes | No blanket client grants |

- [ ] Check actual schema/table/column/sequence/function grants and RLS using PostgreSQL roles, not source-code inspection. For SECURITY DEFINER functions, explicitly audit owner, `search_path`, parameter validation, caller/owner session checks and revocations from PUBLIC/anon/authenticated.
- [ ] The ALL-243 proposed `allin_v2_device_ingest` NOLOGIN role and gateway are **not yet operational**. Resolve its source/session-proof path, `auth.uid()` spoofable-GUC risk, `SELECT FOR UPDATE` vs UPDATE/RLS requirements, and replay/nonce lifetime *without* granting direct client metric-table writes.
- [ ] Test two concurrent owners, session expiry/revocation, owner switching, wrong session/plan revision, duplicate and changed-payload retries, race conditions, denial of cross-owner source/nonce, and transaction rollback under real roles.

### C. Evidence and application handoff

- [ ] Approve the metric-specific measurement-quality input to the existing scalar writer. Preserve both measurement and parent-source quality; a partial or rejected sample never inherits trusted status from its device.
- [ ] Approve exact versioned registry definitions, canonical units, allowed sports and source classes. Recorded zero stays zero; absent data stays absent. Conflict across versions is unresolved, never first-wins.
- [ ] Implement and test one authenticated Completed Activity detail adapter matching the existing mobile DTO, with safe formatted units, no raw provider IDs or private Storage paths, and explicit route/series eligibility.
- [ ] Connect the *existing* ALL-251 export/delete path (metadata **and actual private Storage bytes**) and verify owner-switch and deletion lifecycle before any hosted migration.
- [ ] Rerun clean disposable Supabase migration/replay and commit-matched CI **after** exact reviewed SQL and grant changes; then device-backed iOS/Android start/finish/detail tests. Prior green candidate runs are not proof of these later changes.

**Smallest safe next implementation:** reconcile the current ALL-243 real PostgreSQL two-owner/NOLOGIN gateway fixture and its `FOR UPDATE` permission boundary first. Keep any changes in review-only candidates and the existing CI workflow. Then request owner approval of the precise unit-1 SQL/FK/grant diff before versioned migration work. No automatic production approval is implied.
