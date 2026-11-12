# ALL IN 365 V2 — First signed founder iPhone build

**Status:** Source-only build configuration added; no iPhone binary signed, installed, submitted, or distributed.  
**Owner:** V2 founder-beta delivery under ALL-208 / ALL-209 / ALL-87.  
**Repo:** `allinproject/All-In-V2`; branch `integration/v2-foundation`; app `apps/mobile-v2/`.

## What is already available

- Expo Router V2 app and committed lockfile.
- `app.config.ts` requires independently verified `ALLIN_V2_IOS_BUNDLE_ID` and `ALLIN_V2_EAS_PROJECT_ID`. No V1 Apple identity or invented identifiers.
- `eas.json` explicitly separates `founder-ios-device` (internal/ad hoc signed device) from `founder-ios-testflight` (App Store/TestFlight signing). Neither automatically submits the app.
- `scripts/check-v2-founder-ios-build.mjs` verifies profile safety, app identity, V2 Supabase public configuration and absence of public privileged secrets. `--config-only` is safe in CI; `--device` and `--testflight` require real environment settings. This check does **not** validate Apple credentials, create a binary or access the network.
- Existing `v2-engineering.yml` validates clean npm install, TypeScript and iOS/Android JS bundles; **JS export is not a signed native iPhone app**.

## One-time account/device authority (founder action)

1. Confirm ownership/access to an **Apple Developer Program** team capable of signing this *new V2 app*. Locate the actual App Store Connect bundle identifier; do not reuse V1's identifier unless that was explicitly verified as intentional.
2. Link the V2 app to the actual Expo/EAS project and capture its project UUID. This is an identity/linking action, **not** a deployment. The local build environment must use that exact UUID.
3. Choose the first install path:
   - **Internal iPhone:** `founder-ios-device`; the device must be registered for the correct Apple team/provisioning profile (the EAS CLI guides through registration). This avoids TestFlight upload, but requires a signing-capable Apple account.
   - **TestFlight:** `founder-ios-testflight`; App Store Connect app/bundle setup and Apple signing required. Building alone does **not** upload; submission requires a separate explicitly authorized action.
4. Make the real V2 **Supabase publishable key** available in the trusted build environment along with the known V2 URL; never place a service-role key in `EXPO_PUBLIC_*`.

> Do not put Apple credentials, Supabase service-role keys, EAS tokens, billing private keys or signing material in GitHub files or screenshots.

## Local terminal preflight (no build)

On an up-to-date checkout, from `apps/mobile-v2`, supply the verified nonsecret identities and public V2 key through your build environment:

```bash
export ALLIN_V2_IOS_BUNDLE_ID='<verified V2 Apple bundle identifier>'
export ALLIN_V2_EAS_PROJECT_ID='<verified Expo EAS project UUID>'
export EXPO_PUBLIC_SUPABASE_URL='https://xarhuczrtzuiljmtdaeu.supabase.co'
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='<actual V2 publishable key>'
node ../../scripts/check-v2-founder-ios-build.mjs --device
```

The values above are placeholders, **not commands to run unchanged**. On Windows PowerShell use `$env:VARIABLE_NAME='value'` instead of `export`.

Only after preflight and the founder's approved Apple/EAS project identities:

```bash
# Manual, explicitly authorized founder build: no auto-submission.
npx eas-cli build --platform ios --profile founder-ios-device
```

A separate TestFlight build, if chosen:

```bash
npx eas-cli build --platform ios --profile founder-ios-testflight
# Explicit TestFlight submission is a separate later action.
```

These commands are **future operator steps**, not evidence a build has been launched. Confirm current EAS CLI installation/availability and exact Apple signing prompts before running them. Do not silently initialize another Expo project or accept a different Apple signing team.

## First iPhone acceptance sequence

1. Confirm bundle identity, provisioning, signing, and install on the actual iPhone.
2. Open V2 and verify correct app branding, initial route, legal/access gates, and no crash before sign-in.
3. Confirm the intended V2 legal Terms/Privacy/Founder Beta documents are actually published and approved **before enabling self-service signup**. Never open signup simply to simplify testing.
4. With a permitted founder account, test sign-in, restore, logout/login, legal and onboarding, Today and Train navigation, and native IAP initialization only when entitlement QA is approved.
5. Verify the Goals route is honest about its not-yet-deployed reader; do **not** count a nonworking approval button or empty placeholder as a passed feature.
6. Capture a real device build ID, commit SHA, bundle identifier, signing team, install evidence, screenshots, route results and failures in the beta acceptance issue, without storing private credentials.
7. Repeat cross-account sign-out/restore, schema upgrade and permissions tests as domain backends are deployed.

## Release blockers this configuration does not solve

An internal founder preview is **not** paid/public launch readiness. Real backend schema/grants, Coach and other domain integrations, StoreKit/TestFlight purchase lifecycle, final legal publication, Apple account/signing and installed-app E2E remain individually tracked. Avoid making the first signed shell depend on every post-beta provider integration, but never bypass security or legal gates to create an account.
