# ALL-251 — Authoritative account export pagination, Stage-1 review

**Status:** Review-only implementation and disposable validation. No hosted migration, Edge activation, Storage bucket, or release approval.

## Owning workflow

This extends the **existing** ALL-251 account export request, session authorization, private archive, and Profile export. It is not a second download API or a new source of truth. The source of truth for covered `user_id` relations is still `V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql`, plus the existing Training fragment.

The review-only `V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql` asserts exact catalog equality: all **42** owner-scoped tables already allowlisted by the canonical export must exist; new ones must be reviewed. It includes `auth.users` (restricted identity fields) and four owner-visible directional Community views: outgoing follows, incoming follow requests, owner-initiated blocks and owner action receipts. Pair-CAS revisions and incoming blocks are deliberately excluded. Unknown directional Community tables fail closed even without `user_id`.

The server-only `trainingExportCanonicalPgReader.mjs` uses one dedicated **REPEATABLE READ, READ ONLY PostgreSQL transaction** for inventory and every stage-time page. No client-defined SQL, table, owner, or session is trusted. Each page invokes the existing signed-in Auth session and approved durable export request gate, and is limited to 25 rows and 1 MB. Offset cursors are currently bounded (2 million rows) and **must not be represented as unlimited-size performance guarantees**. Page boundaries are stable only while that same transaction remains open.

The existing `v2-training-account-export-worker-candidate.mjs` supports the new pinned adapter. It authorizes the owner and session, opens the pinned snapshot once for staging, then stores encrypted pages in the existing private archive. The later download reads the frozen private manifest rather than querying fresh, mutable account tables, and rechecks Auth/request authorization before each page. This prevents a new database transaction from silently changing the staged snapshot ID.

## Why the reader deliberately reports incomplete

The SQL catalog returns `complete=false`, even when all 42 tables exist and are paginatable. This is a **necessary privacy/release gate**, not a defect to bypass:

- Unresolved Community pair revision export/redaction and private third-party block decisions
- Full private Storage object **bytes**, checksum, ownership, and retention—not just SQL metadata
- Owner-controlled data from future schema domains and cross-domain media references
- Signed-in client download, server-only key-management lifecycle, restore and cancellation acceptance
- Formal all-domain privacy/legal scope approval and staging/production migration review

The runtime worker **refuses to stage a complete archive** while the canonical inventory is incomplete. Do not flip the flag solely to make CI green.

## Evidence and remaining acceptance

The first local Supabase acceptance [run #43236016844](https://github.com/allinproject/All-In-V2/actions/runs/43236016844) passed: the 42-table catalog plus five additional sources; 53 Coach messages over three owner pages; service-only permission; correct session/request; Community owner/block separation; and rollback-only fixtures. Node smoke includes registry equality against the existing snapshot source, transaction scoping, bounded page requests, failure rollback, worker staging and encrypted frozen-manifest download. The follow-up unknown-table and privacy negative tests have their own CI run.

**Still required before claiming full end-to-end archive acceptance:** independent-session mutation tests around the long-lived snapshot, populated multi-domain fixtures (not just empty tables and Coach/Goals/Community samples), approved Storage objects and KMS in staging, all-domain large history (>5 MB across actual sources), two physical devices' download/cleanup behavior, and privacy/legal approval. V2's hosted processor remains OFF. No production changes are authorized here.

## Updated owner-source verification — 2026-11-12

The existing canonical reader is **not** being replaced or duplicated. Its source registry must match the 42-user-owned-table allowlist in the ALL-251 snapshot, with five explicitly reviewed account/Community collections. Future `user_id` or directional Community tables block export until registered and privacy-reviewed.

[Disposable foundation CI #43238767766](https://github.com/allinproject/All-In-V2/actions/runs/43238767766) at `991d4376` **PASSED** the 47-source inventory, 53-record Coach pagination, and independent 32-record Completed Activity pagination under one owner/snapshot, excluding a separate athlete's records.

[Disposable foundation CI #43239503738](https://github.com/allinproject/All-In-V2/actions/runs/43239503738) at `ef1e718` **PASSED** an additional independent-PostgreSQL-session mutation regression: a concurrent append does not appear in an already-pinned REPEATABLE READ source, but is visible in a fresh snapshot after commit. A follow-up hardening waits for a PostgreSQL `PgSleep` wait event to prove the first session pinned its snapshot before the competing write, and adds per-record owner provenance assertions for all 47 collections. These last safeguards require **their own exact-commit CI pass**, not an inferred pass from the earlier runs.

**Release boundary:** The actual SQL inventory intentionally returns `complete:false` because private Storage bytes/media and Community pair-revision/third-party privacy rules are unresolved. The ALL-251 worker refuses a complete downloadable archive while that condition holds. This code validates current V2 review-candidate sources, **not yet uncreated future Nutrition, Cookbook, Progress or gear-related owner tables**. Once those schemas are introduced, add exact identities and payload/retention/Storage contracts in this same canonical owner reader. Do not enable hosted migrations, live Storage, or Edge download on the strength of these test passes.

## Stage-1 data-source reconciliation — 2026-11-12

The owner inventory must recognize alternate ownership keys (owner_id, athlete_id, actor_id, created_by_user_id), not only user_id. Review-only Billing candidates include owner-scoped checkout attempts and purchases and join-only verified events. The existing ALL-251 export candidate now proposes redacted billing projections, excluding internal provider IDs. Exact two-owner database acceptance remains required before treating this domain as validated.

Owner-visible Community relationships are outgoing follows, recipient-visible follow requests, actor-owned block decisions and action receipts. Incoming block decisions and shared pair-revision CAS state remain undisclosed pending an explicit privacy/legal owner decision. The canonical Community post ledger uses owner_id and must receive a separate owner-only data export contract before activation.

Private Storage coverage now has a server-only Training media audit using the existing evidence reader and recursive owner-scoped object listing. It verifies exact object identity, privacy, byte length, checksum and rejects unknown public or owner-unreferenced objects. That is not complete media coverage; Community photos, Nutrition photos, Progress media, and future data sources still require schema-specific contracts.

The inventory deliberately returns complete:false. No production migration, Storage bucket, Edge endpoint, key release, deletion-worker activation or live account exposure is authorized.

## Stage-1 media, Community and future-domain safeguards — 2026-11-12

**Private Storage/media:**
- The existing `trainingExportSupabaseStorage.mjs` now includes `auditOwnerPrivateMediaCoverage`, rather than inventing another archive API. It compares exact canonical series/route object references against an **exhaustive, owner-scoped Storage object catalog**. Unknown buckets, foreign paths, orphaned or missing files, duplicate references and incomplete enumerations fail closed. A future Progress-photo bucket is **not** presumed covered by workout media.
- The existing `trainingExportCanonicalPgReader.mjs` can read Storage bucket identities, owner object paths and canonical activity references under the **same read-only REPEATABLE READ snapshot** as the account source inventory. Source media identity is classified separately from the private export-archive bucket, which is generated output.
- The optional restricted media downloader verifies actual file size and SHA-256 against the canonical source, including distinct route vs time-series authorization. No raw media bytes or public Storage URL are included in the audit result. **Even `bytesVerified:true` does not make an account download complete**; media-byte delivery into the final encrypted archive, additional domain media and retention approval remain unimplemented.
- Existing isolated Node tests and the additional pinned-snapshot negative tests cover unknown/photo buckets, orphaned/foreign entries, mismatched checksums, missing object bytes, size bounds and incomplete listings. A real hosted private bucket is still absent from V2 and is not deployed by these changes.

**Community relationship privacy:**
- Both the canonical inline snapshot and the restricted paginated reader now filter `incoming_follow_requests` across **either direction of an active block**. This protects an owner against leaking a counterparty's private blocking decision through historical follow state. Outgoing blocks remain owner-owned; **incoming blocks and shared pair-revision CAS rows remain excluded**, with `complete_community_export=false` and `complete=false`.
- Existing two-owner rollback fixtures were updated to assert the redacted counts. The first disposable replay at [#43248631263](https://github.com/allinproject/All-In-V2/actions/runs/43248631263) failed because its **old expected count** was stale; the fixture was corrected in commit `0b53f22`. The corrected run must pass before this change is called PostgreSQL-validated.

**Future Nutrition, Progress and other source registration:**
- The paginated inventory retains exact equality against the existing 42-table owner allowlist and adds fail-closed classification of meal, pantry, macro, body, equipment, race, achievement and personal-record families. Alternate owner columns including `account_id`, `profile_id` and `athlete_user_id` cannot bypass review merely by omitting `user_id`.
- The existing rollback-only SQL and Node registry tests enumerate representative future schemas and require denial until a domain owner extends **this same canonical registry** with a privacy/retention contract. Do **not** create placeholder user tables in production to satisfy the audit.
- The SQL read-only inventory must continue returning `complete:false` until explicit Community, Storage and legal scope decisions plus staged end-to-end tests are accepted. No production migration, Edge activation or bucket creation was authorized in this slice.


## Step-3 authoritative inventory checkpoint — 2026-11-12

**Verified source of live truth:** a read-only `pg_catalog` relation/owner-column
inspection against live V2 Supabase `xarhuczrtzuiljmtdaeu` (no DDL or data
changes). The currently installed V2 schema has **nine directly user-owned
relations**: `public.v2_profiles`, `public.v2_profile_settings`,
`public.v2_onboarding_progress`, `public.v2_legal_acceptances`,
`allin_private.v2_health_considerations`,
`allin_private.v2_profile_settings_actions`,
`allin_private.v2_onboarding_actions`,
`allin_private.v2_account_deletion_requests`, and
`allin_private.v2_account_deletion_execution_audit`.
No Storage buckets are installed in live V2. Other current V2 relations
include reference/legal documents, provider cache and deletion-processor
configuration, which are **not** directly owner-scoped history.

**Proposed larger graph is not deployed:** the existing review-only paginated
reader requires **42** exact direct-owner relations and eight additional
Auth/Community/Billing projections (50 collections total). It must not
interpret missing proposed tables as empty histories or assert release
completeness against the 9-table live foundation. The canonical inventory
continues reporting `complete=false`.

**Safeguard parity fixed:** the inline snapshot now applies the same full
future-domain family and alternate owner-column guards as the canonical
paginated reader, including meal, pantry, macro, body, equipment, race,
personal-record and achievement families, plus account/profile/athlete-user
ownership keys. A Node regression test requires exact guard parity on every
change; adding a new family to one reader without the other fails CI.

**Owner-visible export-request history:** the paginated export now uses an
explicit owner-scoped projection for
`allin_private.v2_account_export_requests_candidate`. It includes owner,
request ID, status and timestamps, excluding internal `session_id` rather
than exporting a raw operational request row. A regression test rejects
accidental raw serialization.

**Remaining independent acceptance gates:**
- Private Storage: exactly enumerate and export byte-for-byte media files,
  including future Community, Nutrition and Progress photos, with strict
  ownership and third-party privacy; current Training media-only audit is
  insufficient
- Community: preserve actor-visible actions and incoming-request block
  redaction; shared pair CAS state and incoming blocks remain private;
  Community posts/media need their own approved source projections
- Billing: provider identifiers and receipt secrets remain redacted, with
  purchase-join and account ownership checks
- New domain schemas: Nutrition/recipes/meal prep, goals/progress/PRs,
  equipment/shoes/bikes, races and other owner or actor fields must be added
  when introduced; do not create placeholder source tables for export tests
- Provider-side KMS, full hosted private media staging, authenticated download
  and physical-device acceptance are not complete; legal/retention review
  has not authorized a whole-account completion claim

This checkpoint does not change live database grants, schema, production
behavior, temporary staging deployment, or user sign-up. Never set
`complete=true` or enable the default-off export function on the strength
of catalog-parity tests alone.

## Step-3 pinned Training media eligibility gate — 2026-11-12

The existing pinned `trainingExportCanonicalPgReader.mjs` now includes
`state` for both `v2_activity_series` and `v2_activity_route_objects`,
and `privacy_state` for route objects in the same REPEATABLE READ
owner-scoped evidence query. The existing
`auditOwnerPrivateMediaCoverage` checks that each referenced media row is
`ready` and each route has explicit `private` or `redacted` visibility
before permitting private Storage reads. Pending, revoked, public, and
unclassified route media are rejected. Independent regression tests exercise
each of these denials without reading private bytes.

This closes a privacy eligibility gap in the Training-specific media audit,
**not** full owner media coverage. The media reader still requires a separate
owner-scoped Storage catalog and exact SHA-256 verification, remains bounded
to the reviewed Training bucket and does not authorize or classify Community,
Nutrition, Progress, or any future photo bucket. The all-domain inventory
stays `complete=false` until those domains and legal policy are approved.

## Step-3 Community, Nutrition, Progress media source reconciliation — 2026-11-12

This is a **source-to-export inventory reconciliation**, not a new database,
media bucket, upload system, legal approval, or whole-export release.

| Domain | Actual canonical candidate | Owner identity | Media contract today | Export disposition |
| --- | --- | --- | --- | --- |
| Community posts | `docs/architecture/sql/V2-COMMUNITY-CANONICAL-POSTS-OWNER-CANDIDATE.sql`, `allin_private.v2_community_posts` | `owner_id` references `v2_profiles(user_id)`; `source_id` links a shared workout/food source, not a media file | No bucket, path, byte checksum, ownership proof, photo redaction or retention model in this source | **Blocked.** Existing alternate-owner table guard rejects an installed post ledger until the owner-only post projection, audience/third-party privacy and relevant file reference graph are approved; do not infer photo ownership from `source_id` |
| Food Log | `docs/architecture/candidates/ALL-247-food-log-first-writer.review.sql` and `ALL-247-food-log-lifecycle.review.sql`; `public.v2_food_log_entries` and `allin_private.v2_food_log_write_actions` | Both have `user_id`; Food Log includes `deleted_at` tombstones and versioned edits | No image reference or photo bucket in the reviewed lifecycle | **Blocked.** Preserve all approved owner-visible consumed events including deleted/tombstoned entries as reviewed, without exposing private action fingerprints. Existing `v2_food_%` inventory guard stops silent omission. No photo export can be claimed |
| Progress | No canonical `v2_progress_*` media/owner-table migration in the inspected V2 foundation; Progress is still an owning product domain | Not established; do not guess `user_id`, `owner_id`, or `athlete_id` | No approved progress/photo object contract or Storage bucket | **Blocked.** The `v2_progress_%`, `v2_body_%`, `v2_personal_record_%`, `v2_achievement_%` guards and alternate owner-column checks require explicit owner-schema review when implemented |
| Training evidence | Existing canonical activity series/routes and pinned `trainingExportSupabaseStorage.mjs` / `trainingExportPrivateMediaPages.mjs` | `user_id` and owner-prefixed object path; `state=ready`; route `privacy_state=private/redacted` | Private workout bucket, exact referenced bytes and SHA-256 checks in isolated tests | **Training-only test coverage**, not complete-account coverage; limits and snapshot consistency still apply |

**Verified live distinction:** Live V2 has no Community, Food Log or Progress
source tables and no Storage buckets as of this read-only check. These named
SQL files are review candidates, not production migrations. The explicit
ALL-251 catalog-alignment tests now link these **actual owner contracts**
to the existing fail-closed SQL guards, and prohibit a future migration
appearing without a refreshed export decision.

**Next approval/implementation slices:** when the owning domain schema lands,
register exact SQL collections and redacted per-owner projections in the
existing ALL-251 canonical reader; only then add source-specific media
reference rows (bucket, canonical owner, stable object path, size, SHA-256,
privacy state, retention), exhaustive owner bucket listing, verified private
byte pages and two-owner/third-party denial tests. An unknown or public
bucket must still block ALL-251. Never invent a placeholder photo table,
create a second export system, or set `complete=true` to pass tests.

## Step-3 review-only owner-post pagination projection — 2026-11-12

The existing canonical paginated SQL reader now contains an explicit
`community.my_posts` **owner-only candidate projection** from
`allin_private.v2_community_posts`: id, owner, kind, audience, title,
body, source_id, post_version and publication/update timestamps. Its SQL
filters `WHERE p.owner_id=$1` before returning any row and orders by
publication timestamp and post ID for stable page boundaries within the
existing pinned repeatable-read snapshot.

**This is not an enabled export collection.** The inventory still excludes
`community.my_posts`; the page function rejects any collection absent
from the inventory, and the client-side scoped reader also has a restricted
collection name allowlist. The underlying Community post table remains a
review-only, undeployed source. The reviewed catalog continues reporting
`complete=false`. No photo/media fields, incoming blocks, pair-CAS
revisions, public-feed visibility, or other athletes' content are exported.
Activating this projection requires a coordinated owner schema/migration,
per-source privacy/retention and media acceptance, and two-owner SQL tests;
only then can the canonical inventory and scoped reader be extended together.

## Step-3 rollback-only two-owner source-projection validation — 2026-11-12

The canonical paginated reader now contains **two deliberately inactive**
source projections. Neither is registered in the real inventory and neither
authorizes mobile access or a complete export:

- `community.my_posts`: original `allin_private.v2_community_posts` rows
  for exact `owner_id`; owner-only `private`, `followers` and `public`
  post history, stable `published_at,id` pagination, source ID, revision,
  audience, text and timestamps. Never use the public-feed reader for the
  owner's own archive. Any third-party relationship state remains excluded.
- `food.my_entries`: original `public.v2_food_log_entries` for exact
  `user_id`, including `deleted_at` tombstones, revisions, date/meal,
  quantity/unit, entered and unknown nutrition values. Do not use the active
  Food Log view, which would omit deleted owner history. The private
  `allin_private.v2_food_log_write_actions` request-fingerprint ledger is
  **not** serialized.

In the isolated foundation replay, the new rollback-only fixtures
`scripts/test-all251-community-post-export-projection-local.psql` and
`scripts/test-all251-food-log-export-projection-local.psql` load the exact
canonical source candidates, create two synthetic Auth sessions and approved
requests, and first prove the **real registry rejects** the unapproved
source tables. Within the same transaction, a **test-only inventory override**
simulates future source approval while keeping the real owner/session/request
authorization gate. The tests then exercise the actual paginated projection,
owner isolation, 25-row page boundaries and the private/deleted data lifecycle.
`ROLLBACK` removes all fixtures and restores the actual inventory function.

**This harness does NOT imply actual source approval.** Production remains
without these source migrations and without their media bucket ownership,
privacy policy, retention acceptance or external KMS. The canonical registry
still reports `complete=false`; the download function stays disabled.
