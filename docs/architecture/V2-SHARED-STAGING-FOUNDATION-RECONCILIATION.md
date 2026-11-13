# ALL-222: reconcile the shared V2 staging foundation without replacing other domains

Date: 2026-11-13. Target: existing **temporary, shared staging** Supabase project `fbtgknlxjyeqrxemskbl`. Canonical V2 project `xarhuczrtzuiljmtdaeu` is out of scope. This is a **review/acceptance plan, not authorization to migrate production or staging**. Do not reset either database or make a new competing data model.

## Authoritative state inspected

- Canonical V2 has **18** applied foundation migrations, numbered `20261110021548` through `20261111134456`. It owns `public.v2_profiles`, profile settings, onboarding/legal, private health, account deletion request/processor safeguards and `public.v2_export_my_account_snapshot(uuid)`.
- Temporary staging has **12 separate migrations**, not an ordered prefix of those 18: 5 ALL-251 private Storage/export/deletion stages, 6 ingredient/USDA operator stages for ALL-228/225, and 1 ALL-217 Coach stage. It has some domain configuration/evidence rows; do not assume it is disposable data.
- On direct read-only inspection staging lacks canonical `v2_profiles`, `v2_profile_settings`, `v2_onboarding_progress`, `v2_export_my_account_snapshot(uuid)`, `v2_training_plans`, `v2_completed_activities` and owner reader. It *already has* `allin_private.v2_account_deletion_requests` and `allin_private.v2_account_export_requests_candidate`.
- Staging account deletion status constraint includes `cancelled`, while the canonical foundation's first deletion migration has a smaller set, then later upgrades it through its own migration chain. A plain replay produces relation-name collision; `CREATE TABLE IF NOT EXISTS` would hide mismatched checks/triggers/grants and is unacceptable.
- Staging Coach tables and functions `v2_coach_threads`, `v2_coach_messages`, claim and request policy are independently owned, as are `v2_food_log_entries`, its action ledger and Nutrition ingredient catalog. All inspected domain tables have RLS enabled. Their existing grants, FKs, and populated rows must survive any reconciliation unchanged.
- Review PR #15 currently carries six versioned **review-only** Training/Completed migration files. It includes existing ALL-251 candidate export integration and optional ALL-253 indoor competitions; neither should silently become a live write workflow. PR #15 is draft/unmerged, and its review head is diverged from current `integration/v2-foundation` (observed 42 commits behind), so it must be reconciled with the newest branch before any release.

## Safe ownership-preserving order

1. **Freeze a current evidence manifest, not the database.** Refresh GitHub integration head and Supabase staged 12-migration list and all relevant SQL definitions just before changes. Record table/column/check/constraint/fk/trigger/function/grants fingerprint for ALL-217 Coach, ALL-228/225 Nutrition and ALL-251 account lifecycle; include minimal per-table row counts and storage bucket identities, without exporting personal content or secrets.
2. **Build an exact staged-foundation bridge in an isolated PostgreSQL/Supabase replay first.** Introduce only missing canonical profile, settings, onboarding/legal and appropriate auth/profile trigger contract. Do **not** run canonical deletion request `CREATE TABLE` again or overwrite its existing staged status, request IDs, sessions, grants or any preservation facts. Keep the existing `public.v2_handle_new_user()` trigger naming/ownership contract canonical, and test real Auth signup without touching earlier operational systems.
3. **Reconcile the account lifecycle explicitly.** Compare canonical production request constraints, cancellation transitions, ownership, expiry/processing gates and private Storage awareness against staging's existing ALL-251 request and export candidate. Add guarded adaptations on the *existing* lifecycle tables only where needed; preserve all old records, grants, audit evidence, service claims, and disabled deletion workers. Do not replace `v2_begin_account_export_candidate` or treat it as the canonical full owner export.
4. **Preserve Coach and Nutrition contracts.** After the bridge, confirm source grants, RLS, FKs and function definitions for both domains and run prior ALL-217/228/225 acceptance. No changes to ingredient operator IDs or Nutrition evidence; no alternate Coach conversation store. Any new account export must fail closed while those owner tables or private Storage bytes are uncovered, then extend the existing owning ALL-251 workflow instead of granting a partial snapshot.
5. **Only after preflight and exact contract parity:** install the six reviewed Training+Completed Activity migrations to an approved dedicated staging release environment or a verified compatible restored clone, then verify two real independently authenticated disposable users through PostgREST HTTP and revoke-session denial. Ensure optional ALL-253 competition remains disabled and no unapproved private writer grant is exposed.
6. **Release decision:** require independent representative recovery/export/deletion, Storage, auth/revocation, and UI device acceptance. Do not merge PR #15 or apply to canonical V2 until the exact migration plan, staged compatibility and security gates are signed off.

## Hard stop conditions

- Existing ALL-251 relations have different constraints, hashes or migration history; a migration tries to recreate or drop them.
- Existing Coach or Nutrition table, function, trigger, grants, RLS or operator evidence changes unexpectedly.
- Deletion worker, paid Coach send, ingredient publication, competition scoring or unrestricted client write becomes active.
- Staging is approaching its scheduled deletion; save a non-sensitive validation report and coordinate preservation of only necessary test evidence before that cleanup. Never suppress an already-approved cleanup without an explicit new decision.
- An exact hosted Auth callback, existing private Storage archive or export-related rule is missing from the staged blueprint.

## Review artifacts

- `scripts/v2-training-hosted-staging-readiness.sql`: simple read-only object inventory.
- `scripts/v2-staging-foundation-reconcile-preflight.psql`: psql read-only migration history/RLS/ownership gate; **designed to fail** on current staging until reviewed bridge is complete. It must never be used as a deployment script.
- `scripts/test-v2-training-staging-http-readers.mjs`: prepared authenticated HTTP acceptance harness (no staging credentials stored, no writes). Not executed against hosted staging due to missing foundation/fixtures.
- [Draft PR #15](https://github.com/allinproject/All-In-V2/pull/15): migration review and no-deploy tests, **not a staging-approved release package**.

**Status:** inventory and reconciliation guards prepared; actual shared-staging foundation bridge deployment and real HTTP acceptance remain blocked pending exact account-lifecycle compatibility and release sequencing. Do not report hosted schema reconciliation as completed.
