# ALL-243 — Native iPhone/watchOS target and real-device acceptance

Status: **staged integration, NOT a compiled or installed native release**.
Source/Node/Ruby checks can run on Linux. An Xcode compile, signed
iPhone/Watch installation, and genuine native/provider acceptance require
macOS with Xcode plus a paired iPhone and Apple Watch. No expensive macOS CI,
EAS build, device registration, or hosted Supabase mutation is authorized by
this document.

## Canonical build path

Keep the existing `apps/mobile-v2` Expo/React Native project; do not create
another canonical app. Expo regenerates `ios/` on prebuild. Canonical Swift
sources live in `apps/mobile-v2/native/apple-watch/`, outside generated iOS.
The existing optional iOS EAS lifecycle hook invokes
`scripts/integrate-apple-watch-build.cjs` **after** Expo prebuild and CocoaPods
install. The Ruby script `scripts/integrate-apple-watch-target.rb` extends the
single generated app Xcode project with a single-target SwiftUI watchOS
`ALLIN365Watch` app, embeds it into the iPhone app, and adds iOS native
WatchConnectivity/App Attest and React Native bridge sources. The code refuses
missing native projects, changed iPhone signing identifiers, absent source or
unexpected existing watch target type.

**No third-party watch-runtime dependency** or parallel workout storage was
introduced. Normal Expo Go, Android, development and existing signed builds
remain unchanged until opt-in.

### On an approved Mac with Xcode

1. Verify the actual App Store Connect / Apple Developer iOS bundle ID and
   signing team. Do not use a guessed identifier or an old V1 ID.
2. Configure the approved iOS credentials and `ALLIN_V2_IOS_BUNDLE_ID`.
   Export `ALLIN_V2_WATCH_NATIVE_ENABLED=true` only for the intended native
   acceptance build.
3. In `apps/mobile-v2`, install locked dependencies with `npm ci`, then
   generate the native project with `npx expo prebuild --platform ios`.
   After CocoaPods are installed, run `npm run watch:integrate-native`
   locally (on EAS iOS the post-install hook is automatic).
4. Inspect `ios/*.xcodeproj` using Xcode or
   `xcodebuild -list -project ios/<generated-app>.xcodeproj`.
   Verify that the original Expo iOS app is intact and the watchOS
   `ALLIN365Watch` target exists with derived
   `<verified-ios-bundle-id>.watchkitapp`. Inspect the `Embed Watch Content`
   phase and native iPhone module references.
5. Compile the Watch target for an available watchOS simulator using Xcode;
   then compile the **iOS app target** to catch React Native bridge and
   embedded watch signing/configuration issues. Do not claim a pass merely
   because Expo JavaScript exports succeeded.
6. Sign BOTH targets using the approved team and matching provisioning
   profiles; do not upload or distribute until specific release approval.

If a native build fails, leave the feature off and record the exact Xcode
error in ALL-243. Do not weaken entitlement, app ID or source-proof checks.

## Real device test matrix — required, NOT yet performed

Prerequisites: an enrolled and trusted iPhone App Attest key that was
independently validated by Apple's server certificate chain; actual Watch
companion installed on a paired iPhone/watch; approved staging Supabase
Training/Completed Activity schema and registration roles; two test
athletes/accounts; WatchConnectivity availability.

| Scenario | Required evidence/acceptance |
| --- | --- |
| Watch installed | iPhone and watch contain the correct signed targets; pairing screen opens on watch |
| Pairing request | Signed-in iPhone fetches watch public key, derives same watch-key fingerprint, requests owner/session-bound challenge |
| On-watch approval | Only tapping Approve on the watch releases the exact P-256 challenge signature; no remote-only acceptance |
| Trusted iPhone assertion | Previously Apple-attested app key produces valid monotone App Attest assertion over watch signature/challenge; server checks both signatures |
| Paired record | Private registry contains exactly one owner/source registration with audit; source writer sees the same owner |
| Decline | Watch declines, server registers nothing, nonce/challenge not falsely completed |
| Wrong account | Signing in as account B cannot use account A's watch challenge or device registration |
| Replay | Old watch response, app assertion count, challenge, or final proof is rejected without duplicate pairing |
| Disconnect/revoke | Owner can revoke device; later workout upload and pairing proof fail closed |
| Offline/unreachable | No silent self-certification; genuine delayed retries are safe/idempotent |
| App reinstall/watch reset | New keys require fresh authorized enrollment; old device cannot be silently transferred |
| Power/performance | No background pairing loop, no unnecessary heart-rate/GPS sampling, no surprise battery drain |

Record for each scenario: iOS/watchOS/Xcode versions, build SHA, app/watch bundle IDs
(without revealing credentials), device model and OS, sanitized local logs,
result and related Linear issue. Do not share private keys, bearer tokens,
signed assertion bytes, or personal health data.

## Unresolved blockers

- This environment **cannot run Xcode or access the user's physical iPhone
  or Watch**, so native compilation and physical acceptance have **not**
  occurred. The compiled targets only exist after running the opted-in
  post-prebuild generator on macOS.
- The real Apple App Attest certificate-chain/nonce verifier and trusted
  phone-key enrollment must be accepted and installed. Current CI tests seed
  a synthetic pre-attested key in disposable PostgreSQL, not a genuine Apple CA.
- Apple Watch is **not** hardware-attested by WatchConnectivity; the signed
  watch key demonstrates possession controlled via a verified paired iPhone.
- Native signing identifiers, Apple capabilities/entitlements, watch provisioning
  and first signed founder iOS/watchOS build require independent verification.
- Real hosted staging account/device acceptance and deletion/restore remain
  separate from isolated PostgreSQL/Node tests.

**Release policy:** No EAS build, hosted migration, production endpoint
activation, Apple Developer account registration or device release is
authorized here. Keep `ALLIN_V2_WATCH_NATIVE_ENABLED` unset for normal
builds; keep the backend pairing and ingestion endpoints default-off.
