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

All runs are local/disposable or CI review-only. **No hosted Training or Completed Activity DDL was deployed by these tests.**

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

## 4. Release cut acceptance (all must pass before hosted DDL)

- [ ] ALL-222/243/246 sign off source identity, canonical aggregate FKs, plan revision lifecycle, metric registry and exact source/quality model.
- [ ] ALL-239/244/234 publish authoritative Goal/Event/course/participation identity and version contracts. Review dual-event and mixed sport collision scenarios.
- [ ] ALL-251 verifies same-release account deletion, Storage cleanup, export fragment/bytes and installed mobile export-version compatibility.
- [ ] Review ordered, **versioned** migrations against refreshed hosted migration history; include rollback and forward-fix strategy; avoid temporary unguarded grants; never alter already-applied files.
- [ ] Replay the approved final migrations, not review-only candidate files, against a clean disposable Supabase stack; assert RLS, all seven table privileges, all function grants, real roles, cross-owner FKs, concurrency, retries and account export/deletion.
- [ ] Validate real provider/device source ingestion, data provenance, duplicate correction and offline/reconnect; never claim measured facts from candidate-only SQL.
- [ ] Validate installed iOS/Android Training calendar → start/finish → Completed Activity Overview/Details/Coach, protected owner reads, account switching, multi-event plans and profile export/deletion. Verify build/type generation.
- [ ] Obtain explicit authorized release approval before hosted deployment; verify post-deploy grants/schemas and keep unapproved workers/features OFF.

## 5. Next smallest executable decision

Obtain the **ALL-239 Goals and ALL-244 EventHub canonical owner key/version/participation contracts**, rather than adding a new Training or event schema. Then approve the first release unit and its exact FK/ACL matrix, stage versioned migrations, and rerun the complete local release acceptance. Green candidate SQL tests are necessary but not sufficient.
