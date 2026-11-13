# ALL-210 / ALL-217 — Isolated iOS staging Coach read acceptance

## 2026-11-13 full mobile CI and iPhone handoff

**Validated source-level mobile engineering:** GitHub [V2 Engineering run 43479555488](https://github.com/allinproject/All-In-V2/actions/runs/43479555488), checkout commit `c6313eaa55433bb22460c23133e4fbc2d7f1fa25`, completed **SUCCESS**. Full clean `npm ci`, security/source lint, `npm run test:auth`, Cookbook and Training regression suites, strict `npm run typecheck`, Expo public config, and **both iOS + Android JavaScript exports** finished successfully. Initial run [43479053997](https://github.com/allinproject/All-In-V2/actions/runs/43479053997) exposed four strict TypeScript errors in existing Coach/Kitchen/Apple Watch/Event Plan code; these were each corrected narrowly before the passing SHA, without disabling typechecks. The build-profile config-only check also passed. The output is **not** a signed EAS IPA or installed-phone acceptance.

**Existing project identity recovered from previous verified Expo account setup:** `@durben-ventures/all-in-365-v2`, project UUID `169f85ef-4372-4b8b-bc63-9850335bf517`. The existing signed staging profile is `coach-staging-ios-device`, using the staging Supabase URL and Coach send OFF. That UUID is project metadata, **not** evidence that a registered physical iPhone or Apple provisioning profile exists.

**Hard remaining blockers, independently checked:** An earlier EAS `device:list` returned “Couldn't find any teams for the account durben-ventures” and no iPhone UDID, signing certificate, provision profile or installed build has been confirmed. No new potentially billable EAS build was authorized or started. Live temporary staging `fbtgknlxjyeqrxemskbl` currently has **0 published legal versions** and **0 Auth users**; real legal review/publication and actual signup/consent/onboarding remain prerequisites for any signed-in Coach UI acceptance. Operational account deletion remains OFF.

**Correct next acceptance path:** verify the existing Expo project and Apple Developer team/device registration with the founder, recover existing remote signing credentials (do not create guessed identities), verify EAS preview public key is for temporary staging, obtain explicit build cost authorization, then issue **one** internal iPhone EAS staging build. Install it on a registered iPhone and verify startup target lock, real signup/legal/consent gate, session restore, foreground/background, account switching, Coach read-only history, and strict no paid sends. Record real build ID, provisioning/device metadata, actual screen/device checks, and eventual test fixture cleanup. If legal remains unpublished, fail closed and report the installed build as **legal-blocked**, not accepted.

## Status

**Source prepared, no signed device build executed or installed.** Existing approved
temporary Supabase staging project: `fbtgknlxjyeqrxemskbl`. This is not the
primary V2 Supabase project. Protect the existing staging project from concurrent
teardown until approved acceptance is complete, then follow its scheduled cleanup
protocol. Do not create a new paid project.

Canonical hosted HTTP acceptance already passed: 15/15 empty-history tests and
13/13 nonempty persisted owner-read tests with real JWTs, source-authoritative
message IDs, cross-owner rejection, independent-login continuity and cleanup.

## Build profile

`apps/mobile-v2/eas.json` now has a dedicated `coach-staging-ios-device` profile
with internal iOS distribution, existing remote credentials, explicit EAS `preview`
environment, exact staging URL, `EXPO_PUBLIC_V2_COACH_READ_ENABLED=true`,
`EXPO_PUBLIC_V2_COACH_SEND_ENABLED=false`, and
`EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE=true`.

`src/lib/supabase.ts` invokes `assertCoachStagingBuildEnvironment` at startup.
A staging acceptance build fails closed if pointed at any other Supabase URL,
without a publishable key, without read enabled, or with sends not explicitly
disabled. The existing founder and production build profiles are unchanged.

**Configuration dependency:** the EAS `preview` environment must provide
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the *temporary staging* project.
It is a public client identifier, NOT a server-secret/service-role key. Verify the
managed preview value is for the exact staging project, not a primary V2 key.
Do not place `sb_secret_*`, service roles, database passwords or provider
credentials in `EXPO_PUBLIC_*`, build profiles, or mobile code.
Do not publish `EAS` updates to other app channels as part of this check.

The approved existing EAS project ID, actual iOS bundle ID/signing identity,
enrolled test-device UDID, and build credit/cost decision must be confirmed
before running a new cloud build. Do not guess an ID, mint a new signing identity,
or consume a paid build solely for this acceptance.

For an *approved existing* EAS project with available credentials, from
`apps/mobile-v2` the expected command is:
```powershell
npx eas-cli build --platform ios --profile coach-staging-ios-device
```
That command **starts a cloud build**; it was NOT run as part of this source change.

## Hard prerequisite: canonical Auth/legal/onboarding

The Coach route `app/coach.tsx` requires a genuine current Auth session and
the existing `AccessGateProvider` to return `ready` (published Terms,
Privacy and Founder Beta Terms accepted, then required onboarding completed).
No Coach-specific shortcut, fabricated acceptance, or bypass is permitted.

As of 2026-11-13 staging has `public.v2_my_profile_state()` and
`public.v2_accept_legal_documents(...)`, but
`public.v2_legal_documents` has **zero rows**. The staging app cannot pass
its legal gate today. ALL-216 / ALL-209 owners must publish approved real
legal text and validate account onboarding/consent in staging before a device
Coach screen can be considered connected. Do not invent legal text or use
pre-accepted disposable accounts that skip real review.

## Device acceptance (not yet executed)

1. Confirm EAS project/bundle/signing/device IDs and managed staging public key
   for an approved internal build, avoiding duplication/cost.
2. Verify Auth, three published legal documents, actual legal acceptance and
   onboarding through the canonical staged app UI.
3. Install the staging-only iOS build. Confirm it points to the temporary
   staging project, Coach shows authenticated **read-only** history, and no
   enabled send control is present.
4. With an approved disposable-but-reusable staging account, preseed a fixed
   paired canonical Coach exchange using the existing trusted writer without
   provider calls; verify real HTTP readback as already proven in isolation.
5. Open Coach on device A and check exact IDs, roles and text; force-quit and
   relaunch the same installed app, verify the exact same conversation survives.
6. Sign in with the same staging account on device B and check the same thread
   and exact messages. Verify a different account cannot see those messages.
7. Verify token refresh/session expiration, account switching, denial, and
   reauthentication. Delete disposable fixtures only after all device
   observations and evidence have been collected.
8. Record signed build ID, device and OS metadata, screen evidence, exact
   checks, clean teardown, and issue acceptance in ALL-210/217. Never
   classify HTTP simulation as actual iOS restart/device evidence.

Keep paid sends disabled throughout. Primary V2 production project untouched.
