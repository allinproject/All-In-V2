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

## 5. Next smallest executable decision

Obtain the **ALL-239 Goals and ALL-244 EventHub canonical owner key/version/participation contracts**, rather than adding a new Training or event schema. Then approve the first release unit and its exact FK/ACL matrix, stage versioned migrations, and rerun the complete local release acceptance. Green candidate SQL tests are necessary but not sufficient.
