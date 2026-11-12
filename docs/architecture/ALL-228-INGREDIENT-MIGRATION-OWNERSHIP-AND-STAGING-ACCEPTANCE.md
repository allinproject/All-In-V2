# ALL-228 / ALL-225 — Canonical Ingredient Database migration ownership and staging acceptance

**2026-11-12 — implementation evidence and remaining hosted release gates.**

## Authoritative ownership, not a second source of truth

- V2 deployable Supabase migrations are **only** `supabase/migrations/YYYYMMDDHHMMSS_*.sql` in `allinproject/All-In-V2`, integrated on `integration/v2-foundation`. Do not generate timestamps manually or write SQL directly into a migration outside the Supabase CLI migration command; never rewrite already deployed migrations.
- On 2026-11-12, the canonical V2 Supabase project `xarhuczrtzuiljmtdaeu` reported **18 applied migrations**, matching the 18 migration files on this branch, from `20261110021548_v2_auth_profile_legal_foundation` through `20261111134456_v2_owner_bound_current_data_export_snapshot`. The canonical ingredient catalog is **not deployed** there.
- The temporary `All-In-V2-Temporary-Staging` project `fbtgknlxjyeqrxemskbl` is **owned by ALL-251 export/deletion acceptance**; it reported 5 applied *ALL-251-only* staging migrations and no ingredient schema, reviewer identity or writer. A cleanup reminder was already scheduled for November 13. Do not add ingredient tables to that shared temporary project without explicit cross-workstream approval and a safe cleanup plan; do not extend its lifetime by default.
- The existing ingredient SQL is still **review-only** under `docs/architecture/sql`. It is one proposed physical catalog and one canonical writer, **not** a second production data system. There are no ingredient files under `supabase/migrations` yet. No existing migration should be amended to insert these candidates.

## Candidate dependency sequence for a future *approved* migration

1. `V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql`: tables, constrained source IDs and aliases, unique ready-default profile, RLS and read-only athlete permissions
2. `V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql`: private reviewer registry/audit, status CAS, immutable source digest verification, default-denied publishing role
3. `V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql`: restricted, expiry-controlled human/workload registry fields and immutable enrollment events
4. `V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql`: immutable source energy evidence and attestation writer

This order was exercised in isolated PGlite and native PostgreSQL. **Do not assume it is production-migration-ready**: review DDL for existing schema collisions, grants, table ownership, RLS/security definer scope and migration rollback strategy before any approved Supabase application. A production deployment must also reconcile concurrent branch changes and the ALL-12 recovery release gate.

## Approved and executed non-hosted staging acceptance — no additional project or service

We used disposable PostgreSQL created inside a dedicated no-deploy GitHub Actions runner instead of reusing ALL-251 shared staging. The test workflow `.github/workflows/v2-ingredient-native-auth.yml` runs `scripts/test-v2-ingredient-native-concurrency.py` with an explicit localhost/ephemeral opt-in; it never accepts a Supabase host or production credential.

The test creates one short-lived **non-human PostgreSQL LOGIN** `allin_ing_workload_native_*`, randomized password, `NOINHERIT` reviewer membership, and a private workload registry row. It authenticates through actual `127.0.0.1:5432` PostgreSQL TCP connections, performs two canonical review transitions and immutable USDA-source energy attestation within a transaction, replays without duplicate audit events, demonstrates public/table writes and publisher access remain denied, and confirms revocation. It also proves a wrong password is rejected and role membership revocation blocks `SET ROLE`. Eight pinned USDA food forms, method selection, competing CAS, source-digest race, audit and credential revocation tests run alongside it. All database/logins/passwords are discarded when the runner ends; secrets are not committed to repo/Linear or supplied to client/Coach.

**Verified success:** [Native restricted PostgreSQL acceptance](https://github.com/allinproject/All-In-V2/actions/runs/43287371562), commit `a95c234288dced4d16e218c76d4ddf21a5706a0c`; earlier successful run [43287099309](https://github.com/allinproject/All-In-V2/actions/runs/43287099309). These tests establish genuine isolated database authentication, not an independently authenticated Supabase login, operator MFA or deployed hosted ingestion. Separate review-only CI covers the JS hosted-readiness fail-closed logic.

## What still requires a separate authorized hosted acceptance

- Designate an approved **persistent or specifically temporary ingredient-owned Supabase staging environment** and its budget/cleanup owner; the existing ALL-251 temporary environment is not implicitly approved for this purpose. Prefer a compatible existing **V2 staging target** only if it can be safely isolated and its migration history/recovery evidence reconciled; do not create a paid project without explicit budget approval.
- After reviewing the candidates and latest migration state, use the official Supabase CLI to create approved versioned migration(s), apply only to the approved staging target, confirm no unexpected public Data API exposure, run advisors, then verify relevant RLS and schema owners.
- Establish an actual independent restricted DB connection using the deployment's approved secrets manager and TLS verification, a dedicated non-shared machine credential, short expiry/rotation, no `service_role` or `postgres` client credentials and no direct table UPDATE or audit SELECT. Validate fresh `session_user`, role activation and privileges with `checkHostedIngestReadiness`. Mere Supabase connector `postgres` SQL access **cannot** prove this.
- Perform populated hosted ingestion of the eight licensed USDA food forms and representative exceptions through the **existing** source/identity/energy writer, test wrong password/disabled/revoked machine, concurrent duplicate requests, source revision races and rollback on bad evidence. Verify authorized-athlete reads and unauthorized private/audit writes using distinct sessions.
- Prove cost-safe data cleanup and restoration, independently review source licenses/attribution, then grant publisher only after a separate controlled release approval. Production `calculation_ready` and public Ingredient Database publication remain disabled until that authorization and the ALL-12 release gate.

**No hosted ingredient schema migration, real Supabase service login, new project, production publication, or paid vendor has been created or authorized by the isolated acceptance evidence.**

## 2026-11-12 — reuse of ALL-251 temporary hosted Supabase staging (executed)

The founder explicitly directed reuse of `All-In-V2-Temporary-Staging` (`fbtgknlxjyeqrxemskbl`) rather than buying a second environment. This is temporary shared ownership: **ALL-251's five existing migrations were not modified**, and its Auth/deletion/export tables contained zero records before changes.

**Installed TEMPORARY-ONLY hosted migrations after checking no object collisions**, in order, all returned success and are recorded only in the disposable project's migration history:
1. `20261112193004_all228_temp_only_canonical_ingredient_catalog`
2. `20261112193012_all228_temp_only_private_review_writer`
3. `20261112193019_all228_temp_only_ingredient_operator_lifecycle`
4. `20261112193025_all225_temp_only_usda_energy_attestation`
5. `all228_temp_disabled_no_password_ingest_role` (version from temporary project's migration history): `allin_ing_workload_temp_all228` has LOGIN/NOINHERIT/NOBYPASSRLS but **PASSWORD NULL**, a disabled workload registry entry with no identity attestation or expiry, reviewer membership only and **no publisher membership**. It cannot authenticate with a password or call the private writer while disabled.

**Verified on hosted Supabase:** all canonical tables/private functions installed, RLS enabled, `anon`/`authenticated` lack private schema access, private writer EXECUTE and direct profile UPDATE, and `service_role` lacks private audit SELECT. In one transaction a synthetic `candidate` profile was inserted, `SET LOCAL ROLE authenticated` could not see it (`count=0`) or update the profile, and `ROLLBACK` left zero ingredient/profile/event rows. Direct attempts to call the private writer and energy attester as the available `postgres` admin connection were both denied by function guards. An attempted `SET SESSION AUTHORIZATION` to impersonate a workload was rejected by hosted Supabase with SQLSTATE 42501; rollback was confirmed: no probe login, operator or food remained. **Never call that an independently authenticated test.**

**Important managed-Postgres nuance:** The managed Supabase role creator automatically received administrative, non-inheriting/non-settable membership in both new NOLOGIN reviewer and publisher roles (`member_role=postgres, grantor=supabase_admin, inherit=false, set=false`). There is **no ordinary athlete or workload publisher membership**; the function forbids a `postgres` session from reviewing/publishing. Do not misstate this as zero PostgreSQL memberships. The candidate SQL comments were corrected in commit `989e859`.

**Protected credentialed continuation prepared:** `scripts/check-v2-ingredient-hosted-workload-connection.cjs` plus tests and manual-only `.github/workflows/v2-all228-temporary-hosted-workload.yml` target **only** `integration/v2-foundation`, exact `db.fbtgknlxjyeqrxemskbl.supabase.co`, port 5432, `verify-full` TLS and `allin_ing_workload_temp_all228`. Workflow uses the already-existing GitHub environment `all251-temporary-staging`, requires a new *protected staging-only* secret `ALL228_TEMP_STAGING_PGPASS_LINE`, writes it to a 0600 temporary pgpass file, and removes it afterward. It rejects unknown host, user, port, TLS downgrades and connection overrides. It is only a **read-only independent login readiness test**; full credentialed ingest and rollback still require an approved source-seeding and enrollment ceremony. The connected GitHub actions cannot provision environment secrets; no password or claimed identity was fabricated. Do not configure this with production credentials.

**Mandatory cleanup:** Existing November 13 temporary project deletion reminder remains. Do not extend the project or use production to finish missing tests without a fresh budget/owner decision. After any actual credentialed test, revoke role membership, disable registry, destroy password/secret and verify no reserved resources; deletion should proceed when ALL-251/ALL-228 evidence has been saved. Hosted ingredient schema remains **not present in the production V2 project**.

**Migration ownership:** These installed versions are temporary-project acceptance records, **not canonical V2 application migrations**. The eventual production release still requires approved versioned files under `supabase/migrations`, collision/grant review, ALL-12 recovery acceptance and independently approved rollout.

## 2026-11-12 credential provisioning gate — protected local ceremony

The hosted ALL-228 test now uses **Supabase's session pooler on port 5432**, not the IPv6-only direct database address. GitHub-hosted Actions runners cannot reliably connect to the direct IPv6 endpoint without a paid IPv4 add-on. Use only the actual `[region].pooler.supabase.com` hostname copied from this temporary project's **Supabase Connect → Session pooler** settings; never guess a pooler hostname. The pooler username is `allin_ing_workload_temp_all228.fbtgknlxjyeqrxemskbl`.

A one-time secret-safe local helper, `scripts/provision-v2-ingredient-temp-login.py`, is committed to the integration branch. It requires locally authenticated `gh`, `psql` and Python, and `ALL228_STAGING_CA_CERT` pointing to the **trusted PEM root CA** for the Supabase database SSL chain downloaded from the project's dashboard. It prompts for the session pooler host, requests explicit temporary-project confirmation, generates a cryptographically random workload password **in memory**, stores the corresponding exact-host .pgpass entry as GitHub environment secret `ALL228_TEMP_STAGING_PGPASS_LINE` under existing `all251-temporary-staging`, and uses a separately authenticated administrative psql session with `verify-full` TLS to activate the *existing* restricted workload for **45 minutes**. It triggers the manual `.github/workflows/v2-all228-temporary-hosted-workload.yml` and never prints the password or generated SQL. No secret should be pasted into chat, committed to GitHub, or copied into Linear.

Example from a trusted local checkout at `integration/v2-foundation`:

```powershell
$env:ALL228_STAGING_CA_CERT = 'C:\\secure\\supabase-temp-root-ca.pem'
py -3 scripts/provision-v2-ingredient-temp-login.py
```

The helper asks for this temporary project's **postgres database password** using psql's interactive prompt; it does not ask for the V2 production password. If prerequisites/credentials are missing, do not fabricate values. The action is a protected **read-only authenticated capability smoke**, not a completed hosted USDA import. The workflow must report a real independent `session_user` and least-privilege grants before any further ingestion tests. Only a separately controlled server-side source writer/approved staging fixture may populate the canonical tables.

The existing temporary staging role **remains DISABLED, PASSWORD NULL, with no publisher membership** until the local ceremony is actually run. Runbook prepared and source-only CI tested does not establish provisioning. After actual acceptance, revoke the workload, delete the protected environment secret, retain evidence and delete the temporary project on its scheduled November 13 cleanup. Do not extend the environment merely for this test.
