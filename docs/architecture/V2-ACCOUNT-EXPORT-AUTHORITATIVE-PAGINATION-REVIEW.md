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
- `public.v2_food_log_entries`: original `public.v2_food_log_entries` for exact
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

## Fuel four-owner-table registry gate — 2026-11-12

ALL-247 also authored `ALL-247-ALL-251-fuel-export-fragment.review.sql`
and `ALL-247-ALL-251-fuel-privacy-preflight.review.sql` covering Food Log,
hydration and redacted owner-visible action receipts. This **review-only**
fragment has no general client EXECUTE grant; the privacy preflight explicitly
reports `export_registered=false` and `ready_for_release=false`.

The paginated ALL-251 candidate keeps provisional, owner-filtered
projections for `public.v2_food_log_entries`,
`allin_private.v2_food_log_write_actions`,
`public.v2_hydration_events`, and
`allin_private.v2_hydration_actions`. None of the four enters the active
42-table canonical owner registry until ALL-222, ALL-247 and ALL-251 accept
the shared schema, inline-export parity, Auth/session owner gate, private
metadata redaction, media coverage and retention. A premature four-table
registration on 2026-11-12 caused the canonical Node source parity test to
fail; the review-only projections were preserved while deferring registration.
Unknown Fuel tables continue to **block** a complete export rather than
silently disappearing. Never activate a second `food.my_entries` alias.

## Four Fuel source regression coverage — 2026-11-12

The existing single rollback-only `test-all251-food-log-export-projection-local.psql`
now exercises all four proposed Fuel collections using the exact ALL-247
Food Log and hydration review schemas under two synthetic Auth owners.
The actual ALL-251 approved owner/session/request bridge stays required.
Inside that same rollback transaction, a **test-only registry override** lets
the gated projections be exercised without registering them in the real
release inventory.

- Food entries: 27 owner A records over 25+2 pages and one owner B record,
  including a deleted tombstone, revision history, explicit unknown calories
  and a genuine numeric zero.
- Hydration entries: 28 owner A records over 25+3 pages and one owner B
  record, preserving `drink` versus `refill`, a deleted event and the
  original and canonical volume units.
- Action receipts: owner A/B Food and Hydration receipts are included only
  with action ID, result ID/revision and timestamps; private request
  fingerprints, replay hashes and cross-owner metadata stay excluded.
- Both new collections also exercise wrong-session/owner denial and assert
  `completeUserExport=false`.

Source-level regressions require correct projection fields and ownership,
no private action internals, and explicitly verify that NONE of the four
candidate tables enters the canonical owner inventory before owner schema,
media and retention approval. Actual PostgreSQL and CI acceptance results
remain distinct from documenting this intended contract.


## 2026-11-13 — Live/staging source classification reconciliation (ALL-251 step 1)

This is an evidence-backed classification checkpoint, **not approval of a
complete account export**. Read-only catalog checks observed 12 `v2_*`
application tables in live V2 `xarhuczrtzuiljmtdaeu` and 28 in the
approved temporary staging project `fbtgknlxjyeqrxemskbl`. These are
distinct deployment snapshots; neither may be assumed to represent the
full intended canonical Training/Completed Activity/Fuel/Community schema.
The paginated candidate still requires its own exact reviewed owner-table
registry, approved Auth/session/request, and repeatable-read snapshot.

| Existing source class | Current observed tables | ALL-251 export treatment |
| --- | --- | --- |
| Owner Profile, onboarding, legal | `public.v2_profiles`, `v2_profile_settings`, `v2_onboarding_progress`, `v2_legal_acceptances` and associated private owner action rows | Preserve owner-only redacted projections in the existing canonical reader |
| Coach owner content | Staging `public.v2_coach_threads`, `public.v2_coach_messages`, `allin_private.v2_coach_turn_claims` | Owner-visible conversations only with complete history and provenance; internal request fingerprints/turn-claim credentials are not raw exportable fields |
| Consumed Food Log | Staging `public.v2_food_log_entries`, `allin_private.v2_food_log_write_actions` | User consumption records, exact quantities, source and tombstone history require the already-drafted ALL-247 projection; redact replay fingerprints and do **not** classify internal action rows as absent. Hydration is not yet installed in staging |
| Ingredient/nutrient catalog | Staging `public.v2_ingredients`, `v2_ingredient_*`, `v2_nutrient_definitions` plus private independent review/attestation tables | **Reference/operational candidate** only. Catalog rows are not implicitly an athlete's personal log; independent source-officer identities, review payloads, USDA evidence, and hashes may not be dumped into athlete archives. Must formally review personal user additions or overrides if introduced |
| Coach request limits and operational claims | Staging `allin_private.v2_coach_request_policy` and turn-claim ledger | Policy constants are not personal history. Verify each account-bound operational receipt's privacy/redaction/retention before release |
| Storage/upload safety | Staging `allin_private.v2_privileged_storage_write_leases_review`, two private buckets | **Operational restriction ledger** only. Must be accounted for during deletion/retention, never misrepresented as exported file bytes; account export requires exact private source paths and actual checksummed object bytes through the existing Storage adapter |
| Account export/deletion | Staging `allin_private.v2_account_export_requests_candidate`, `v2_account_deletion_requests` | Redacted owner request/status/time metadata only; never expose `session_id`, key leases, internal audit tokens or service credentials |
| Training/Completed Activity, Events/Goals, Community, Progress, future Nutrition | Candidate contracts exist in source, but the complete production-like source graph is not installed in this staging snapshot | Remain **unapproved for complete export** until all relevant owner relations, alternate-key/counterparty relationships, storage objects, source provenance and replay history are reviewed and exercised together |

The **same additional fail-closed domain guard** now appears in both the
inline and paginated canonical SQL review candidates for
`v2_ingredient_%`, `v2_nutrient_%`, `v2_coach_request_%`, and
`v2_privileged_storage_%`. Existing Food/Progress, alternate-owner and
Community guards remain intact; source-level catalog alignment regression
checks enforce equality. These guards are intentionally conservative: a
legitimate shared reference catalog should be added to an **explicit
reviewed classification** rather than switching complete to true or
silently excluding a new owner-bearing table.

**Release gate:** The canonical inventory reports `complete=false`.
Before a complete archive can be authorized, reconcile and register the
actual deployed owner/counterparty tables (including Food Log/Hydration,
Training and Community) in the existing source registry; review projections
against the owning privacy/retention policy; prove private media bytes,
owner isolation, redaction, cursor consistency and recovery on a
representative populated database. No production migration, new table,
client permission, export-download switch or AWS KMS resource is approved
by this classification checkpoint.


## ALL-246/251 Saved Routine integration verification — 2026-11-14

**Scoped verification now passed in the existing ALL-251 architecture; these are NOT whole-account release approvals.**

- `public.v2_training_routines` and `public.v2_training_routine_versions` are reviewed, owner-filtered portable **paginated collections**. They preserve template identities, archived state, source-backed sport/blocks, immutable version IDs and timestamps, and stable owner ordering.
- `allin_private.v2_training_routine_owner_epochs` and `allin_private.v2_training_routine_actions` remain mandatory **owner/deletion/backup inventory** but are not directly downloadable collections. Their private replay hashes and concurrency metadata must never enter the athlete's archive. The inventory rejects any partial four-table Routine installation, unexpected new owner table, unsafe direct grants or broken reviewed composite version-owner cascade.
- **PASS** [GitHub PG17 run 43547436153](https://github.com/allinproject/All-In-V2/actions/runs/43547436153): existing full Training+Coach+Billing inline export, plus scoped Routine paginated pages (25+7 A templates and B isolation), archival/version preservation, private action exclusion and fail-closed unknown/partial-owner checks. Unrelated Goals/EventHub/Community entries are EMPTY PRIVILEGELESS disposable fixtures in this *scoped* test, not evidence of complete cross-domain export.
- **PASS** [Routine deletion preflight PG17 run 43547845212](https://github.com/allinproject/All-In-V2/actions/runs/43547845212): review-only future canonical deletion claim accepts **only** verified Routine-version composite cascade through Auth-owned parent; still denies a disabled processor, unreviewed noncascade table, or missing Routine FK. Existing migration is unchanged, and no hosted deletion worker was enabled.
- **PASS** [GitHub PG17 run 43548458081](https://github.com/allinproject/All-In-V2/actions/runs/43548458081): separate disposable PostgreSQL logical `pg_dump`/`pg_restore` destination; source/restored all-four-table row fingerprints, exact historic versions/action receipts, RLS/no-client-grant parity, and independent Routine-only Auth cascade. The restored populated account with noncascading Profile graph correctly remains **blocked** from direct full Auth deletion; no constraints were dropped to claim whole-account completion.
- ALL-12 recovery-domain manifest now requires all four Routine tables as one verified database domain. Partial/missing/unknown owner-table coverage still fails.

**Outstanding mandatory release gates:** real hosted ALL-251 complete inline/paginated owner graph and encrypted downloadable file with private Storage/media bytes, approved operational-ledger retention/redaction policy, KMS/credential custody, consistent pinned snapshot/page transport, actual deletion worker/Storage fence and cross-domain cascade acceptance, provider-side independent backup/restore plus measured RPO/RTO under ALL-12, installed-device/account-switch/reinstall acceptance, and privacy/legal authority. The current staging inline export is still the older fail-closed v1; **do not** present the review-only v2 candidate or Routine fragment as a deployed complete archive. `complete=false` and all production gates stay unchanged.


## ALL-251 encrypted Saved Routine archive integrity test — 2026-11-14

- **PASS:** [GitHub no-deploy Training job 43550204477](https://github.com/allinproject/All-In-V2/actions/runs/43550204477), PostgreSQL/Node job `132310685834` at source SHA `35167fa9`. The new regression `scripts/test-all251-routine-encrypted-export-lifecycle.test.mjs` uses the EXISTING trusted encrypted page writer/download verifier, not another export implementation.
- Validated **32 Saved Routine templates over two pages** plus two immutable versions (including an archived revised workout); ciphertext does not contain source names or exercise text, while the independently checked JSONL download reconstructs the 34 records, owner and terminal SHA256 completion receipt.
- Negative cases: missing Routine-version collection or incomplete owner inventory reject staging; foreign-owner row cancels and purges; AES-GCM page tampering refuses download; revoked authorized session prevents opening staged archive.
- Important test limitation: the mock represents a pre-approved **two-collection** snapshot. It proves Routine compatibility with the existing encrypted transport, **not** complete all-domain export, key management, actual R2 bytes, device retrieval, or production authority. The live canonical inventory must continue reporting `complete=false` until ALL-251's full-domain/media/legal gates pass. No hosted/production changes or worker activation were made.
