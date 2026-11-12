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

## Populated local upgrade and transactional rollback — 2026-11-11

The existing local-only Supabase replay now first commits **two synthetic V2 accounts** via the real Auth trigger, including Profile, Settings and Onboarding records, **before** review-only billing DDL. The order is enforced in `.github/workflows/v2-foundation-clean-replay.yml`:

1. `scripts/test-v2-billing-preupgrade-seed.psql` proves two pre-existing owner records and confirms no billing candidate tables were created yet.
2. `scripts/test-v2-billing-schema-rollback-local.psql` applies the exact candidate ledger **and** reviewed service grants in a transaction, then rolls back. It confirms billing tables, receipts sequence and public billing RPCs disappear while both prior accounts survive unchanged.
3. The workflow installs the candidate ledger and grants again; `scripts/test-v2-billing-local-foundation.psql` validates the pre-existing owner records, binds a new subscription to the correct owner, rejects cross-account entitlement, and rolls back every synthetic receipt without removing the existing accounts. The local fixture owners are then explicitly deleted via Auth cascade.

**Observed PASS:** [foundation workflow #43139095462](https://github.com/allinproject/All-In-V2/actions/runs/43139095462), SHA `df4ab7008e2d39296438f4cc03b88610f306ed2e`: pre-upgrade seed, transactional schema rollback, populated owner-binding test and full workflow shutdown each passed. This proves the local source candidate's transactional rollback and compatibility with existing foundation accounts. It is **not** a production backup restore, a populated external beta-like upgrade, a reviewed versioned migration, or authorization to deploy or enable billing. The production recovery rehearsal and signed-store tests remain open.

## Non-default athlete account state upgrade replay — 2026-11-11

Upgraded the local-only two-owner fixture from default rows to **distinct existing user states**: different training-week and privacy preferences, non-default settings versions 3/4, differing onboarding completed/skipped steps, and onboarding versions 2/5. All three existing test scripts verify those exact state values before candidate DDL, after candidate DDL and after transactional DDL/receipt rollback. The original Auth users, Settings and Onboarding records must not reset, merge or leak across owners. These values are strictly synthetic local CI data, not customer records.

**Observed PASS:** [full local Supabase workflow #43139914496](https://github.com/allinproject/All-In-V2/actions/runs/43139914496), source SHA `a07dc4cb8654451717dd9e0000022313e3c1ad88`. Preupgrade seed, transactional schema rollback, populated owner-bound verification and final cleanup all passed, and the aggregate completed SUCCESS. An earlier partial-commit run #43139829130 failed on an obsolete default-version assertion after the seed changed; the exact assertions were updated and the later full run passed. This remains local review-only evidence, not a production backup restore, a deployed versioned migration or real store acceptance.

## Synthetic billing ledger data-backup recovery — 2026-11-11

This is separate from transactional DDL rollback. The existing local-only Supabase CI now runs `scripts/test-v2-billing-backup-seed-local.psql` to create two synthetic Auth-backed owners with three candidate purchases and four immutable events, including a refunded Apple purchase, an active Google subscription and a trial. The workflow then:

1. Executes a real PostgreSQL `pg_dump -Fc --data-only`, selecting only the three candidate subscription tables and no unrelated user data.
2. Deletes the two synthetic owners' **local** billing ledger records while retaining their Auth accounts, confirms receipt and purchase tables are depleted, and executes `pg_restore --data-only --exit-on-error`.
3. Runs `scripts/test-v2-billing-backup-restored-local.psql` to prove restored original ownership, all immutable events, refunded Apple state, owner-specific access and environment isolation. It then checks replay idempotency, rejection of a second account's attempted claim, no repeat-trial eligibility, and a **new** provider renewal recorded after restore with a monotonic receipt identity/revision.
4. Removes the entire synthetic fixture through the real local Auth cascade and deletes the temporary dump file.

**Observed PASS:** [full V2 local Supabase workflow #43142378420](https://github.com/allinproject/All-In-V2/actions/runs/43142378420), source SHA `4f50ddf0f19160c241a5e91e400c772130f14857`. The data backup/restore step and aggregate completed SUCCESS. A previous run [#43141516039](https://github.com/allinproject/All-In-V2/actions/runs/43141516039) had already validated the initial restore; this later run additionally covers post-restore renewal and repeated-trial denial.

This demonstrates only **local synthetic billing data recovery**. It does not validate a remote backup, full PostgreSQL cluster PITR, an offsite snapshot, customer-data restore, an approved versioned migration, production schema permissions, live Stripe/Apple/Google processing or provider notification delivery.

## Connected Stripe sandbox inventory — 2026-11-11

Read-only Stripe account inspection of the connected `Durben Ventures sandbox` (`acct_1Ua6f8RBJdOnJBog`, not livemode) confirmed the active canonical ALL IN 365 Monthly product `prod_VbQgPefruseFHU` and approved recurring USD $9.99/month price `price_1UaDovRBJdOnJBog5swb8zpS`, lookup key `allin365_v2_monthly_usd`. The price's default trial days are null; the seven-day trial is conditionally provided in the existing trusted web checkout request for verified eligible new customers only.

**Remaining Stripe sandbox setup gaps:** no classic webhook endpoints or V2 event destinations configured; Stripe Tax status is pending with head office missing, and the active price has unspecified tax behavior. An unrelated $15/month test product exists and must not be used for ALL IN 365. Do not deploy a webhook before the approved V2 endpoint exists; do not invent an address or tax handling. No Stripe objects or settings were changed during the inventory.

This inventory is not sufficient to launch web billing: the V2 verified subscription ledger and service grants are not yet deployed, checkout/webhook flags remain default OFF, and signed webhook delivery must be validated end to end after explicit approvals.


## Expanded Stripe and recovery-sequence candidate (2026-11-12)

The local-only backup fixture now includes a verified **Stripe web checkout** alongside Apple and Google: **four purchases, four checkout attempts and five original provider events**. The original service-only Stripe claim → pending → finalized → current-event operations are used, not manually fabricated ledger rows. Recovery verifies Stripe's original checkout ID and owner, denial of cross-owner finalization, idempotent provider event replay, and a sixth event from a post-restore Google renewal. Event counts are deliberately **five after restore and six after the renewal**.

The recovery workflow also selects the event identity sequence explicitly in its `pg_dump -Fc --data-only` archive, verifies the presence of a `SEQUENCE SET` entry, deliberately resets the local sequence to 1 before restoring, and requires a new event after restore to succeed. This guards against restoring receipt rows but losing identity sequence state.

**Acceptance not yet proven for this expansion:** the previous [green local recovery run #43142378420](https://github.com/allinproject/All-In-V2/actions/runs/43142378420) predates the Stripe-inclusive and reset-sequence tests. New local CI must pass before they can be marked validated. Billing checks now run directly after the canonical foundation verification, ahead of unrelated Goals/Coach candidates; none of those later checks are skipped. This remains a synthetic local review-only rehearsal, not remote data recovery, production migration approval or permission to activate billing.
