# ALL IN 365 V2

Independent V2 mobile application and backend.

## Canonical V2 resources

- GitHub repository: https://github.com/allinproject/All-In-V2
- Implementation branch: `integration/v2-foundation`
- Supabase project: `xarhuczrtzuiljmtdaeu` (All-In-V2, us-west-2)
- Linear project: https://linear.app/allin365/project/all-in-365-v2-rebuild-1a9ab6dddfca

V1 is a read-only reference for approved product behavior and selected assets. There is no customer base to migrate; the founder creates a fresh V2 account. Do not import V1 credentials, the one test Coach thread or personal training/Food Log records by default.

## Mobile application

The Expo Router app is under `apps/mobile-v2/`.

Current source foundation:
- V2 Supabase client with persistent native session storage and explicit PKCE auth flow for email-confirmation/password-recovery deep links.
- AuthProvider for session restoration, token refresh lifecycle, sign-out and identity changes.
- V2-native sign-in and sign-up screens.
- Sign-up reads the exact published V2 legal documents. It remains disabled until Terms, Privacy and Founder Beta Terms are all published.
- V2 legal acceptance is persisted through `v2_accept_legal_documents` with exact current versions, age attestation and idempotent action ID.
- Access gate reads `v2_my_profile_state`, compares current legal versions and requires all six onboarding steps before opening private routes.
- Progressive onboarding UI resumes from the first unfinished step, saves explicit answers through existing versioned Settings/onboarding RPCs, and leaves skipped optional fields unknown.
- Shared visual tokens follow the approved App Art Handoff v2.
- `src/types/database.types.ts` is generated from the live V2 public schema; `src/lib/supabase.ts` uses `createClient<Database>`. Private schema types are intentionally not exported to the client.

## Supabase foundation

Seven migrations have been applied to the dedicated V2 project:

1. `20261110000100_v2_auth_profile_legal_foundation.sql` — Auth-linked Profile, Settings, Onboarding and Legal foundation.
2. `20261110000200_v2_tighten_profile_privileges_and_legal_versions.sql` — narrowed Profile privileges and immutable published legal versions.
3. `20261110000300_v2_provider_cache_and_private_rls.sql` — private provider cache and defense-in-depth RLS on private operational tables.
4. `20261110000400_v2_onboarding_progress_writer.sql` — private onboarding idempotency ledger and authenticated versioned complete/skip/reset writer.
5. `20261110000500_v2_expected_owner_mutation_guards.sql` — replaces Settings, Legal Acceptance and Onboarding mutation RPC signatures with database-enforced expected-user identity checks.
6. `20261110000600_v2_provider_cache_expired_cleanup.sql` — adds the bounded service-role-only expired provider-cache purge RPC.
7. `20261110000700_v2_provider_cache_cron_schedule.sql` — installs pg_cron 1.6.4 and schedules hourly private cache expiry cleanup as postgres.

They create the V2-owned Auth profile bootstrap, owner-scoped profile/settings/onboarding, versioned legal document store, immutable acceptance receipts, private Settings/Onboarding/provider-cache records, RLS and guarded versioned/idempotent RPCs. Provider cache reads/writes remain service-role-only; a bounded private expiry helper is scheduled through pg_cron as postgres once per hour. The Cron job is active; first scheduled run succeeded at 7:17 AM Central on 2026-11-10. Cache was empty, so no rows required deletion. The six-step onboarding UI uses `v2_set_onboarding_step` for progress and the existing Profile Settings writer for selected answers.

**Current legal status:** no legal documents have been published. Public signup and private app access must remain closed until the working V1 legal draft is reviewed/finalized and the three exact V2 versions are deliberately published. Do not seed or publish draft legal text automatically.

**Current backend status:** no Coach, Cookbook, Training, Nutrition, Pantry, Meal Prep or Community schema/functions have been ported yet. The V1 Coach v18 bundle is preserved as a non-deployable reference at `docs/migration/reference/coach-v18/`.

## Local setup

1. Copy `.env.example` to `.env` and use only the V2 Supabase URL and publishable key for isolated V2 development.
2. Install dependencies with the approved npm workflow (Node >=22.13).
3. Run `npm run test:auth` and `npm run typecheck`.
4. Start with `npm run start`.

The package lockfile, clean install, TypeScript/app test execution, Expo bundle and physical-device checks have not yet passed. Package scripts currently include `test:auth`, `test:calculator`, `test:training-logic` and `typecheck`. Do not claim build or device acceptance until the exact branch is installed and tested. Node >=22.13 is required by the package; use `npm ci` only after the canonical package lockfile is committed.

## Reproducible V2 dependency checkpoint

For a network-connected **Windows PowerShell** checkout on `integration/v2-foundation`, use the guarded local helper from the repository root:

```powershell
.\scripts\prepare-v2-lockfile.ps1
```

This helper checks the branch and existing package changes, generates and validates the lockfile, runs clean `npm ci`, all three Node test suites and TypeScript, and **never commits, pushes, deploys or triggers paid CI**. It intentionally stops on the first failure. Inspect `apps/mobile-v2/package-lock.json` before committing it. Use the following manual commands on other platforms or to run additional Expo exports.

From a networked clone of **this repository** (Node 22.16 or later):

```bash
cd apps/mobile-v2
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
node ../../scripts/check-v2-dependency-manifest.mjs --require-lockfile
npm ci --no-audit --no-fund
npm run test:auth
npm run test:calculator
npm run test:training-logic
npm run typecheck
npx --no-install expo config --type public
npx --no-install expo export --platform all --output-dir /tmp/allin365-v2-export
```

Review and commit `apps/mobile-v2/package-lock.json` only after a successful clean `npm ci` with no `--force` or `--legacy-peer-deps`. The lockfile must be generated for the **current** package manifest, not copied from an older failed workflow artifact. No production credentials are needed for this isolated source-validation sequence; Expo exports may require the deliberately nonfunctional environment placeholders used in `.github/workflows/v2-engineering.yml`. Do not use the placeholder credentials for live authentication testing.

The cheap dependency-free smoke workflow checks React/React DOM manifest compatibility on relevant pushes. The full engineering workflow requires a committed matching lockfile and runs only at a non-draft PR review checkpoint. On the current branch, the full lockfile, npm install, TypeScript and Expo validation remain **unverified**. The full engineering job is a release gate, not a per-commit development loop.

## Security note

Public API tables use least-privilege grants and owner RLS. The private tables `allin_private.v2_profile_settings_actions`, `allin_private.v2_onboarding_actions` and `allin_private.v2_provider_cache` have RLS enabled and no schema usage or direct table privileges granted to `anon` or `authenticated`. They intentionally have no direct API policies; only the narrowly scoped owning SECURITY DEFINER/service-role RPC paths access them. See Linear ALL-223 for applied migration, grant verification, and rolled-back idempotent-writer replay evidence. Supabase's remaining three no-policy INFO notices for these private tables are intentional; do not add permissive policies to silence them. Four authenticated per-user SECURITY DEFINER RPC advisor warnings are documented; these functions check `auth.uid()` and are required by the current client flow.


The access-gate profile-state reader is typed with the generated `Database` contract as well. Compiler validation remains pending the reproducible npm install/typecheck gate.


## Onboarding

The short six-step flow covers focus, current training pattern, availability, Coach guidance, food safety and proactivity. Every step can be skipped; skipped values remain unknown. Answers are saved to the existing Training, Coach, Nutrition and Notification Settings sections. The flow does not request blanket OS permissions; Health, notifications, camera and location permissions remain contextual. Full app typecheck, signed-in installed-device behavior and accessibility acceptance are still pending.


## Authenticated write ownership

Signup, legal acceptance and onboarding verify that the active Supabase session still belongs to the expected V2 account before sensitive writes. The shared guard lives in `src/auth/accessGateClient.ts`; it fails closed on sign-out, account switch or session lookup failure. This source path has focused unit coverage; installed-device account-switch testing and full package/typecheck acceptance remain pending.


All user-scoped mutation RPCs now require `p_expected_user_id` and compare it to `auth.uid()` inside PostgreSQL. A mismatch fails closed with SQLSTATE `42501`, even if an account switch occurs after a client-side session check but before the RPC reaches the database. Old signatures were dropped. Client call sites and generated public types pass the captured account ID. Rollback-only SQL tests for all three RPCs and onboarding idempotency/isolation passed.


## Email confirmation and password recovery deep links

V2 now sends signup confirmation and password-reset emails back through the Expo Router callback route:
- App scheme: `allin365v2` (already declared in `app.config.ts`).
- Callback route: `/auth/callback`.
- Standalone/native callback URI: `allin365v2://auth/callback`.
- Password recovery adds `?type=recovery` and continues to `/reset-password`; signup/email confirmation exchanges the PKCE code and returns to the existing access gate.

**Required external Supabase Auth configuration:** add `allin365v2://**` to the V2 project's Auth Redirect URLs / Additional Redirect URLs allowlist before sending test confirmation or recovery emails. The Supabase project-details API available in this environment does not expose that Auth URL configuration, so its current allowlist has not been verified or changed. Test callbacks in a native development build/installed app, not Expo Go, because Expo Go uses a transient development URL rather than the stable app scheme.

The Supabase client explicitly uses `flowType: 'pkce'`; the code verifier is persisted through the existing Expo SQLite-backed localStorage install. The callback exchanges the one-time PKCE code using `exchangeCodeForSession`. Malformed/expired links fail closed. Password change is guarded by the captured authenticated owner and returns to the normal V2 access gate. The local pure callback resolver tests pass; email delivery, allowlist, and installed-device callback acceptance remain pending.


## Sentry crash reporting (V2-only, staged)

The V2 app now contains a manual `@sentry/react-native` integration rather than the deprecated `sentry-expo` package. The default is **no event uploads** when `EXPO_PUBLIC_SENTRY_DSN` is blank. For an approved development build, set a verified **public** DSN directly in the private local environment (`EXPO_PUBLIC_SENTRY_DSN`), and set `SENTRY_ORG` and `SENTRY_PROJECT` to the actual Sentry organization/project slugs for native build integration. The source does not contain the founder's DSN, account credentials, or any auth token.

The integration wraps the existing Expo Router root, configures Sentry Metro source-map handling, and is restricted to error/crash events. The SDK is initialized with default PII collection disabled, performance sampling disabled, replay disabled, and automatic session tracking disabled. Before events are sent, user, request, context, extra, tags, breadcrumbs, message, exception values, and stack-frame source excerpts/local variables are removed. Additional organization-side Sentry scrubbing is required. This is a **privacy baseline, not a guarantee** that native reports can never contain sensitive information. Inspect actual event payloads before enabling broad beta collection; don't include athlete data or tokens in exception messages.

For native builds, any `SENTRY_AUTH_TOKEN` needed to upload source maps must exist **only as a trusted build secret**, never in the Git repository, app config, `EXPO_PUBLIC_*` variables, or shared screenshots. No automatic paid build or source-map upload has been activated.

### Controlled Sentry installed-app acceptance (pending)

The committed lockfile is present; **do not generate another one simply to configure Sentry**. On the exact target commit, run `npm ci`, `npm run test:monitoring`, `npm run typecheck`, Expo config/export, then install an approved **development build**. Confirm the real public `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG` and `SENTRY_PROJECT` refer to the intended isolated Sentry project, not a guessed organization or another athlete's project.

With the founder's approval, emit **one intentionally synthetic, non-sensitive test exception** from a controlled debug-only entry point, while authenticated user/Coach/Training/Nutrition inputs are absent. Verify receipt under that exact Sentry project, then inspect the raw issue/event for exception value, user/request/device identifiers, tags, breadcrumbs, stack filenames, absolute paths, source excerpts, release identifiers and SDK attachments. Verify real event payloads do not contain athlete content, auth tokens, local usernames, GPS, or private URIs; do not assume that the source scrubber or the Sentry email proves ingestion. Confirm traces, profiling, session replay and unexpected attachments remain disabled; verify source-map resolution only in a trusted build with build-secret handling.

Disable transmission safely by removing the approved build environment's public DSN and producing a new build, or by disabling project ingestion in Sentry if immediate containment is needed; no production release or automatic paid build is part of this acceptance. Avoid injecting a deliberate crash into an ordinary athlete session. Record the exact app commit/build ID, Sentry project, event ID, observed sanitized fields and rollback evidence in ALL-260 before declaring accepted.

The additional Sentry metadata privacy tests now run in the existing low-cost V2 smoke workflow. This is **source regression evidence**, not installed-device crash reporting acceptance.
