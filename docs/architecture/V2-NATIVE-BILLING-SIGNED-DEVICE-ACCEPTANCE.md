# ALL-266 — V2 native billing signed-device acceptance

**Status:** Not accepted. This is a test/approval runbook, not authorization to turn on charging, deploy production SQL, or release builds. The authoritative issue is [ALL-266](https://linear.app/allin365/issue/ALL-266/activate-v2-billing-safely-security-gate-native-packagebuild-stripe). Follow ALL-222 for schema/RLS approval and ALL-264/265 for store-specific acceptance.

## Source already staged

- V2 mobile package and npm v3 lockfile resolve exact `expo-iap@6.4.3`; Expo config includes the `expo-iap` plugin.
- `expoIapNativePort.ts` wraps the real SDK. `nativeBillingRuntime.ts` supplies the single owner-verified, server-backed purchase/restore flow.
- `NativeBillingActions.tsx` is reachable only if **all** four code-reviewed release approvals become true. Those values are currently all `false`. The account screen is read-only until then.
- `v2-native-subscription-verify` is sandbox-only and returns `native_billing_disabled` unless its trusted server-side arming is configured.
- The client never marks a receipt as paid. Receipt ownership and current entitlement are verified on the server before the store transaction is finished.
- A passing Metro/Expo JavaScript bundle is **not** proof of a signed native store purchase.

## External setup to obtain (do not invent)

1. Apple: confirmed V2 iOS bundle identifier and signing team, App Store Connect app, monthly subscription product and 7-day introductory trial eligibility, sandbox testers, StoreKit Server API issuer/key ID/private signing key, and Apple root CA material for signed transaction validation.
2. Google: confirmed V2 Android package and Play Console app, monthly subscription and base plan with trial offer, test-track eligibility, tester accounts, approved offer token, restricted Google Play Developer API service account, and owner-obfuscation pepper.
3. Server: owner-only purchase ledger, service-only functions/RPC grants, RLS, and recovery/rollback acceptance approved in ALL-222; sandbox keys and webhook/notification authentication installed on the trusted server. No secrets in the mobile repository or screenshot logs.
4. Mobile: an approved native development client signed for the matching identifiers and linked to the appropriate sandbox/test track. Expo Go cannot load this native module. Do not start a paid signing/build service without explicit approval.

## Required execution order

1. Refresh `integration/v2-foundation`, ALL-222/264/265/266, Supabase migration state, and latest no-deploy CI. Resolve concurrent work before changing configuration.
2. Verify exact bundle/package/product/base-plan values against actual Apple/Google consoles. Confirm that the native build and server environment agree on identities and subscription catalog; check the real storefront price and trial eligibility rather than trusting the static $9.99 text.
3. In an isolated populated beta-like database, exercise the approved SQL/RPC migrations, owner RLS, replay/idempotency and rollback. Production deployment is separately gated.
4. Run the signed sandbox build on an iPhone and Android test-track device. Verify native connection and product discovery for the configured store SKU and verified Google offer token. Ensure no Expo Go/native-module crash and no leakage of private receipt tokens into logs or analytics.
5. With controlled sandbox-only activation, purchase as owner A; verify server acknowledgement, durable entitlement, correct renewal/expiry, and no local access before server confirmation. Attempt concurrent purchase clicks and delayed/offline callback delivery.
6. Restore after reinstall as owner A; test a second account B, logout/login during purchase or restore, owner-token mismatch, duplicate callbacks and acknowledgments, and the same receipt submitted by B. B must never acquire A's entitlement.
7. Exercise cancellation, retry, failed/duplicated provider webhook or store notification, renewal, grace/past-due, expiration, refund/revocation, and deleted-account receipt handling. Verify immutable event reconciliation and that neither webhook failure nor client state fabricates entitlement.
8. Confirm the account-screen states, accessible labels, legal/trial storefront disclosures, ability to manage subscriptions in the official store, and recovery after an unavailable backend. No trial guarantee for returning subscribers.
9. Record date, build identifier, device OS, test-account scope (no private credentials), provider environment, CI links, owner-privacy cases and pass/fail evidence in ALL-266. Only then propose enabling the next controlled gate.

## Release acceptance blockers (currently outstanding)

- ALL-222 production owner-ledger schema/grants/security approval and controlled migration.
- Verified Apple/Google store identities, subscription catalog, credentials, test accounts and notifications.
- Signed development builds and real end-to-end store lifecycle testing.
- Explicit launch authorization; `releaseReady=false`, server arming OFF and every client release gate OFF remain unchanged.

Never use Stripe web checkout for in-app digital subscriptions. Do not assume store purchases, native signing, production SQL or payments are validated by source-level CI.
