# ALL-247 canonical Food Log reconciliation — 2026-11-12

## Checked source branches
- Shared integration: `integration/v2-foundation` at `9c377233fb6b9f757e1e95b967255ca91ad8ddf1` (refreshed before reconciliation).
- Isolated review: `review/all-247-fuel-food-event-owner-20261112` at `704e37715fc72f782c90a62251ab126c04861ccd`.
- No migration was installed, merged, or deployed as a result of this comparison.

## One-owner decision
The **ALL-247 Food Log** owns confirmed consumed intake. A future approved physical migration MUST select **one** event table, action ledger and writer. The different `v2_fuel_food_entries_candidate` and `v2_food_log_entries` tables are alternative designs, not independent authoritative data stores; **do not deploy both**.

The integration review candidate is currently the acceptance-tested baseline for manual explicit-energy entries, versioned edit/move/delete, RLS, day snapshots and hydration. The isolated candidate brings additional useful precautions: the default-unresolved manual food has no invented nutrients, unit domains must match the actual resolution path, and writer execution must be scoped to an approved principal. Incorporate these into the chosen single Fuel writer before enabling it.

## Required reconciliation before a migration
1. Decide a single table name and typed source/coverage model. An unresolved manual entry must have NULL energy; explicit user-entered kcal may be recorded with provenance **user-entered, not verified**, never automatically promoted to measured/official nutrition. Extend with canonical ingredient/recipe/prepared portion foreign keys only after those schemas exist.
2. Unify quantity unit semantics: unknown density, single piece, serving, and oz conversions must not imply precise mass or energy. Keep original quantity/unit; calculated quantity must have an authoritative conversion.
3. Validate local date against actual IANA zone and instant; guard locale/DST, disallow fake timezone strings.
4. Retain the proven account-bound, serialized idempotent, revision-CAS edit/move/delete and split-day recomputation behavior; exact retries must not reapply after subsequent changes.
5. Reject unauthorized caller roles and direct table writes; review the function owner and privileged execution boundary. A private candidate with no granted execute is not a live feature; a public authenticated owner-RPC requires explicit object-level security review before release.
6. Soft-delete visibility is limited to active entries in ordinary reads; ALL-251 owns retention, export of original events, tombstone policy and permanent account deletion.
7. Daily-budget read treats incomplete logging as incomplete; historical goals need effective dates. Never invent workout expenditure or a confirmed remaining amount.
8. Preserve ALL-47 manual hydration owner and its distinct refill vs consumed-drink semantics; don't build a second hydration ledger.

## Verified versus pending
- SQL rollback suites on integration candidate passed Food Log edit/move/delete and hydration lifecycle, including two-account RLS tests.
- Energy snapshot tests separately passed empty-day, provisional 700/2500, behavior-only, and verified-activity-unavailable cases.
- **Still pending:** full all-cases budget regression, simultaneous-connection contention tests, object grants and real authenticated HTTP, ALL-251 registration, approved migration and installed-device acceptance. Production remains untouched.
- The isolated review branch's manual-only candidate was static-inspected; it was **not** accepted through the same PostgreSQL regression suite. Do not imply it has passed.

This document records the chosen ownership and migration approach, **not** authorization to replace a newer shared schema or deploy either candidate.
