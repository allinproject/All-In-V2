# ALL-244 — V2 canonical all-sport EventHub identity review

**Status:** REVIEW ONLY — not an approved production migration or published EventHub feature.  
**Canonical ownership:** ALL-244 EventHub/event identity; ALL-234 organizer/course evidence; ALL-239 Goals; ALL-246 Training; ALL-222 release security.  
**Repository/branch:** `allinproject/All-In-V2`, `integration/v2-foundation`.

## Founder product authority

EventHub is the former RaceHub **renamed and generalized to all sports**. It is an exact URL-submitted event workout group; **not an event discovery directory**. The athlete supplies a specific public organizer/event URL; a trusted owner service checks/normalizes it, determines a single matching event identity, then proposes joining its group. URL submission and group identity alone are **not** registration, attendance, a result, or permission to publish a workout. Race-specific training/courses belong to their certified specialist. Noncompetitive goals require no event.

## Canonical physical review units

Existing source modules `eventHubUrlIntent.ts`, `eventHubMembershipLifecycle.ts`, `eventHubShareEligibility.ts` remain the client-level contracts. The proposed **single owner** SQL is:

- `docs/architecture/sql/V2-EVENTHUB-IDENTITY-MEMBERSHIP-PARTICIPATION-CANDIDATE.sql` — globally stable `v2_events` identity/version, exact reviewed `v2_event_url_aliases`, one group per event, owner-scoped `v2_event_group_memberships`, and separately owned `v2_event_participations`. All new tables have RLS enabled and app/service direct table grants revoked by default. The URL alias is unique after the *server* certifies identity; URL normalization alone never merges organizer event records.
- `docs/architecture/sql/V2-EVENTHUB-OWNER-EVENT-PLAN-READER-CANDIDATE.sql` — a private, bounded, owner+Auth-session checked view of **actual EventParticipation** for Goals/Training Event Plans. It cannot show a mere URL/group join as registration. It retains exact source verification, event version/date/timezone, participation version/status and separate athlete/organizer source. No client/service EXECUTE grant yet.

The corresponding rollback-only, two-athlete local Supabase checks are `scripts/test-v2-eventhub-local-postgres.psql` and `scripts/test-v2-eventhub-owner-reader-local-postgres.psql`. They run in the **existing** `.github/workflows/v2-foundation-clean-replay.yml` after real V2 foundation/Goals candidate SQL and before unrelated Coach/billing candidate checks.

## Explicit reviewed membership mutation proposal

`docs/architecture/sql/V2-EVENTHUB-MEMBERSHIP-WRITER-CANDIDATE.sql`
extends only the **same** `v2_event_group_memberships` owner with a
private, versioned and idempotent SQL action boundary. It requires a
live owner-bound Auth session; the action ID and exact
`userId/eventId/groupId`; current expected membership version; and
a separately reviewed URL alias for **join**. The other actions are
explicit leave, show participation, or hide participation.
`allin_private.v2_event_group_actions` retains exact retry receipts
while the account exists. Conflicting reused action IDs and stale
versions fail closed. Joining defaults to participation **hidden**,
does not create `v2_event_participations`, and does not publish a
Community workout. Leaving always hides membership visibility.

The review-only rollback replay is
`scripts/test-v2-eventhub-membership-writer-local-postgres.psql`
in the established local Supabase foundation workflow.
No client or service-role EXECUTE permissions are granted. The
future *canonical trusted resolver/gateway* must independently verify
the submitted website and exact alias, signed-in athlete consent,
DNS/redirect safety, group visibility/block policies and rate limits
before it can invoke this writer. This is not proof that the user
has joined a real event or can see another user's workouts.

## Monotonic organizer-source version guard

`docs/architecture/sql/V2-EVENTHUB-EVENT-VERSION-GUARD-CANDIDATE.sql`
requires an exact +1 `event_version` whenever the canonical event's
organizer/source details, event date, timezone, sport, cancellation,
name or verification evidence change. It rejects version-only increments,
skipped versions, event ID reassignment and direct deletion of the
verified canonical event identity. An organizer postponement is not
silently edited into an athlete's previously accepted Event Plan:
that plan must revalidate its stored exact Event version and request
athlete-approved reassessment. The corresponding rollback-only
`scripts/test-v2-eventhub-version-guard-local-postgres.psql`
tests a date postponement, cancellation, version-gap rejection,
identity immutability and denied direct deletion in the same local
Supabase foundation workflow. This is **candidate SQL only**, not a
deployed organizer update service. Do not claim a race's official
date/version without real organizer evidence.

## Identity, participation and visibility remain distinct

1. **Event**: organizer-confirmed or unverified source with version, sport, local day/timezone. One event can have multiple URL aliases only after reviewed provenance; multiple events can occur on the same day even in the same sport.
2. **Group**: EventHub workout-sharing context. Membership requires athlete intent; joining never changes `v2_event_participations`. Group state/visibility must obey blocks and private profiles.
3. **EventParticipation**: a separate owner-scoped status: interested, registered, attended, completed or withdrawn; athlete-confirmed versus organizer-verified source. Never infer participation from group membership. A verified result additionally requires completed status plus organizer source reference. No imported post or device observation changes registration automatically.
4. **Training Event Plan**: uses exact Event version and athlete participation source; an athlete-confirmed interested event may be previewed for planning without asserting registration. A withdrawn event, revoked session, unverified URL, stale version or missing participation cannot silently activate an accepted plan. Multiple events, mixed sports, and general undated Goals remain valid without overwriting one another.
5. **Community publishing**: an event group contains only existing explicitly athlete-shared workout posts with an approved audience, membership and block controls; no automatic sharing from training, history imports, mere URL joins or event registration.

## Release gates not addressed by review-only SQL

- [ ] ALL-244/234 certify actual organizer URLs, redirect/DNS/SSRF safety, versioned source evidence, cancellations/date changes, and duplicate/alias conflicts.
- [ ] Athlete-authenticated group creation/join/leave/visibility writers with expected-version CAS, idempotent retries, live Auth sessions and actual two-user RLS acceptance.
- [ ] Canonical participant status and result verification writers, privacy/retention and account export/deletion coverage.
- [ ] Authoritative Event read API and physical Goal/Training version-bound FKs, plus safe invalidation of accepted plans after an organizer change.
- [ ] Real Community social feed/read and block/follow protections; no feed content from unshared or old imported workouts.
- [ ] Installed phone Event Plan → EventHub link and user-reviewed group interaction, plus cross-account/logout/offline/retry tests.
- [ ] Approved versioned migrations and explicit authorized release decision. No production database or API grants are changed by these candidates.

**Current evidence limitations:** Source-only candidates and disposable tests do **not** prove a working real account or EventHub app. Do not close ALL-244 or ALL-222 based on proposal SQL alone.
