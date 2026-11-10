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
- V2 Supabase client with persistent native session storage.
- AuthProvider for session restoration, token refresh lifecycle, sign-out and identity changes.
- V2-native sign-in and sign-up screens.
- Sign-up reads the exact published V2 legal documents. It remains disabled until Terms, Privacy and Founder Beta Terms are all published.
- V2 legal acceptance is persisted through `v2_accept_legal_documents` with exact current versions, age attestation and idempotent action ID.
- Access gate reads `v2_my_profile_state`, compares current legal versions and requires all six onboarding steps before opening private routes.
- Progressive onboarding UI resumes from the first unfinished step, saves explicit answers through existing versioned Settings/onboarding RPCs, and leaves skipped optional fields unknown.
- Shared visual tokens follow the approved App Art Handoff v2.
- `src/types/database.types.ts` is generated from the live V2 public schema; `src/lib/supabase.ts` uses `createClient<Database>`. Private schema types are intentionally not exported to the client.

## Supabase foundation

Four migrations have been applied to the dedicated V2 project:

1. `20261110000100_v2_auth_profile_legal_foundation.sql` — Auth-linked Profile, Settings, Onboarding and Legal foundation.
2. `20261110000200_v2_tighten_profile_privileges_and_legal_versions.sql` — narrowed Profile privileges and immutable published legal versions.
3. `20261110000300_v2_provider_cache_and_private_rls.sql` — private provider cache and defense-in-depth RLS on private operational tables.
4. `20261110000400_v2_onboarding_progress_writer.sql` — private onboarding idempotency ledger and authenticated versioned complete/skip/reset writer.

They create the V2-owned Auth profile bootstrap, owner-scoped profile/settings/onboarding, versioned legal document store, immutable acceptance receipts, private Settings/Onboarding action ledgers, RLS and guarded versioned/idempotent RPCs. The six-step onboarding UI uses `v2_set_onboarding_step` for progress and the existing Profile Settings writer for selected answers.

**Current legal status:** no legal documents have been published. Public signup and private app access must remain closed until the working V1 legal draft is reviewed/finalized and the three exact V2 versions are deliberately published. Do not seed or publish draft legal text automatically.

**Current backend status:** no Coach, Cookbook, Training, Nutrition, Pantry, Meal Prep or Community schema/functions have been ported yet. The V1 Coach v18 bundle is preserved as a non-deployable reference at `docs/migration/reference/coach-v18/`.

## Local setup

1. Copy `.env.example` to `.env` and use only the V2 Supabase URL and publishable key for isolated V2 development.
2. Install dependencies with the approved npm workflow (Node >=22.13).
3. Run `npm run test:auth` and `npm run typecheck`.
4. Start with `npm run start`.

The package lockfile, clean install, TypeScript/app test execution, Expo bundle and physical-device checks have not yet passed. Package scripts currently include `test:auth`, `test:calculator`, `test:training-logic` and `typecheck`. Do not claim build or device acceptance until the exact branch is installed and tested. Node >=22.13 is required by the package; use `npm ci` only after the canonical package lockfile is committed.

## Security note

Public API tables use least-privilege grants and owner RLS. The private tables `allin_private.v2_profile_settings_actions`, `allin_private.v2_onboarding_actions` and `allin_private.v2_provider_cache` have RLS enabled and no schema usage or direct table privileges granted to `anon` or `authenticated`. They intentionally have no direct API policies; only the narrowly scoped owning SECURITY DEFINER/service-role RPC paths access them. See Linear ALL-223 for applied migration, grant verification, and rolled-back idempotent-writer replay evidence. Supabase's remaining three no-policy INFO notices for these private tables are intentional; do not add permissive policies to silence them. Four authenticated per-user SECURITY DEFINER RPC advisor warnings are documented; these functions check `auth.uid()` and are required by the current client flow.


The access-gate profile-state reader is typed with the generated `Database` contract as well. Compiler validation remains pending the reproducible npm install/typecheck gate.


## Onboarding

The short six-step flow covers focus, current training pattern, availability, Coach guidance, food safety and proactivity. Every step can be skipped; skipped values remain unknown. Answers are saved to the existing Training, Coach, Nutrition and Notification Settings sections. The flow does not request blanket OS permissions; Health, notifications, camera and location permissions remain contextual. Full app typecheck, signed-in installed-device behavior and accessibility acceptance are still pending.
