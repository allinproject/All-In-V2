# ALL-222 / ALL-266 — V2 billing migration approval packet

**Status: review-only, NOT approved and NOT a versioned migration.** No SQL in this packet authorizes a live database change or an enabled checkout. The canonical project is `allinproject/All-In-V2`, branch `integration/v2-foundation`.

## Authority snapshot (2026-11-11)

- Live Supabase V2 project: `xarhuczrtzuiljmtdaeu` (**not** the V1 project).
- At the last read-only inventory: **18 applied V2 foundation migrations**, ending `20261111134456_v2_owner_bound_current_data_export_snapshot`; **zero billing/subscription/entitlement tables** and **zero deployed Edge Functions**. Refresh this inventory immediately before approval; it is not a durable lock.
- The live `allin_private` schema currently has `USAGE` denied to `anon` and `authenticated`, granted to `service_role`. This is baseline evidence, not approval of a nonexistent live billing schema.
- The release gate remains `releaseReady=false`; the four mobile native billing booleans are false; `ALLIN_NATIVE_BILLING_SANDBOX_ARMED` is not to be enabled.
- [ALL-222](https://linear.app/allin365/issue/ALL-222) owns schema, role, RLS and migration approval. [ALL-266](https://linear.app/allin365/issue/ALL-266) owns end-to-end billing activation. [ALL-264](https://linear.app/allin365/issue/ALL-264) and [ALL-265](https://linear.app/allin365/issue/ALL-265) own real Apple and Google store acceptance.

## Exact source contract and ordering

1. Review `docs/architecture/sql/V2-SUBSCRIPTION-VERIFIED-LEDGER-CANDIDATE.sql`. It creates three private owner-bound tables (checkout attempts, purchases, verified events), bounded entitlement projections, owner/receipt collision controls and invoker-only RPCs. All exposed billing RPCs must deny `anon`/`authenticated`; RLS is enabled on private billing tables, with no direct client policies.
2. Review `docs/architecture/sql/V2-SUBSCRIPTION-SERVICE-GRANTS-CANDIDATE.sql` **after** the ledger objects. This is the single source of the explicit `service_role` function/table/sequence grants exercised in PostgreSQL CI; there must be no other grant list embedded in the replay. This grant candidate is not an approved production role expansion.
3. In disposable PostgreSQL 17 only, the existing `scripts/test-v2-subscription-sql-postgres.psql` imports both files and inspects the actual function catalog and permissions. The separate `scripts/test-v2-subscription-race-postgres.sh` exercises concurrency, refund-versus-stale-paid, first-binding identity collision and trial/renewal races. Passing CI demonstrates candidate behavior, not on-device payment correctness.
4. Only after an explicit approval, generate **versioned** Supabase migration(s) through the current CLI workflow with source checksums and ordering, preserving the prior 18 migrations and all newer concurrent project changes. Do not simply rename or copy candidate SQL into a timestamped migration without reviewing the real schema, dependency graph, grants, default privileges, owner FKs, and recovery procedure.
5. Apply to an approved **populated, beta-like isolated database** first. Record migration list/diff before and after, regression and concurrent rollback evidence, full role grants, RLS behavior for both real owner identities, deletion/export integration and a restore rehearsal. The actual project may have newer migrations by then.
6. Before any live release, validate the exact target and migrate only with separate recorded approval, a tested restore point, and controlled deployment process. Use post-deploy catalog readback and an explicit negative check for every client role and every public bridge; capture no raw purchase tokens, provider keys or personally identifying receipts.

## Security sign-off checklist

- [ ] No unreviewed roles, schemas, tables, functions, RPC signatures, providers or write paths; one canonical ledger and original owner binding only
- [ ] `anon` and `authenticated` lack `USAGE/CREATE` on the private schema, every billing table privilege (including `TRUNCATE`, `REFERENCES`, `TRIGGER`), and every receipt-sequence privilege
- [ ] All billing RPCs are `SECURITY INVOKER`, have a pinned empty `search_path`, reject non-service callers, and have no effective client `EXECUTE` grant including inherited `PUBLIC`
- [ ] Explicit grants to `service_role` match the exact reviewed candidate; no broad `GRANT ALL`, role inheritance shortcuts or unreviewed `SECURITY DEFINER` escalation
- [ ] Multi-owner subscription collision, stale events, duplicated provider events, paid reactivation and refund/revocation replay tests pass independently
- [ ] Sandbox and production provider identities, entitlements, trial eligibility and keys remain separated and no sandbox receipt grants production access
- [ ] Profile/account deletion, legal consent, data-export lifecycle and provider reconciliation have an approved durable handling contract
- [ ] Recovery/rollback and pre/post migration role/grant diffs signed off, with post-restore negative privilege testing
- [ ] Store catalog, signatures, API credentials and provider notifications are independently validated by trusted server code
- [ ] Signed iOS and Android development builds exercise trial, purchase, restore, renewal, cancellation, refund, account-switch and reinstall workflows; JavaScript export CI is insufficient
- [ ] `releaseReady` and native/Stripe flags stay OFF until separately approved rollout

## Validation evidence, not release approval

The no-deploy GitHub Actions run [43136797436](https://github.com/allinproject/All-In-V2/actions/runs/43136797436) passed after the grant candidate was wired into the disposable PostgreSQL container. Previous [43136635512](https://github.com/allinproject/All-In-V2/actions/runs/43136635512) failed only because CI had not yet copied the new grant file into the container; it is superseded by the corrected green run. This packet is an approval checklist, not a representation that live billing is secure or deployable.

## Real local V2 foundation compatibility — 2026-11-11

The existing `v2-foundation-clean-replay.yml` now runs the reviewed billing ledger and exact service grants **after** replaying all 18 actual committed Supabase foundation migrations and exercising the existing Training/Activity owner lifecycle. The new `scripts/test-v2-billing-local-foundation.psql` opens a rollback-only transaction with two synthetic `auth.users` accounts, checks that the real profile creation trigger creates both `v2_profiles` rows, then verifies the native service-only binding, replay idempotency, immutable account ownership, sandbox-versus-production separation, owner-specific refund, and billing row cascades upon real Auth account deletion. Other owner's billing data must survive. This avoids treating the older stubbed Auth/Profile schema as sufficient production compatibility evidence.

**Observed PASS:** [V2 foundation run #43138066556](https://github.com/allinproject/All-In-V2/actions/runs/43138066556), workflow head `d8d01fd9f7babed255fc446629c8a749c4d27ef7`, completed success. The real-foundation billing step and service cleanup both succeeded. The run used disposable local Supabase only; the live project's billing schema and functions remain undeployed. A populated external beta-like upgrade rehearsal, recovery point, final grant review and explicit migration authorization remain mandatory.
