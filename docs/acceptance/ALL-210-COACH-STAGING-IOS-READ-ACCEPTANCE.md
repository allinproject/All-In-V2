# ALL-210 / ALL-217 — Isolated iOS staging Coach read acceptance

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
