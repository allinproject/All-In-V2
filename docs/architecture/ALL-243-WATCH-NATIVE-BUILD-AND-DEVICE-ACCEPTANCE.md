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

## Verified Linux acceptance checkpoint (no macOS required)

On 2026-11-12, the existing `V2 Node and PostgreSQL smoke (no deploy)`
workflow completed **SUCCESS**, [GitHub Actions run #43264420622](https://github.com/allinproject/All-In-V2/actions/runs/43264420622)
at exact commit `78e00aeebd8865b82e8032d176aa2042bed0958d`.

The independent `ALL-243 generated Watch Xcodeproj and Swift syntax
(Ubuntu, no Xcode)` job installed `xcodeproj` 1.27.0 and **actually
generated** a disposable Expo-like `.xcodeproj` twice using
`scripts/integrate-apple-watch-target.rb`; verified one iPhone and one
modern single-target watchOS app, correct PlugIns embedding, both Swift
source groups, correct derived Watch bundle ID, and no duplicated build
phase/source references on reapplication. The five canonical Swift files
all passed the Linux Swift frontend **parse-only** gate. The existing
Node/auth, subscription and disposable PostgreSQL jobs also passed.

This proves project-file generation and language syntax, **not**
Apple-framework type-checking, actual Xcode compilation, signing, binary
installation, watch networking, App Attest hardware behavior or real-device
end-to-end acceptance. Modern single-target Watch app embedding uses
PlugIns/ (`dstSubfolderSpec=13`); the old WatchKit dual-target generator
was corrected after the first true xcodeproj idempotence test exposed the
target-discovery bug. Future changes must keep both real xcodeproj and
Swift parse gates green.

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

## Apple App Attest / signed-receipt physical acceptance protocol (NOT YET RUN)

This is the **single** reproducible ALL-243 acceptance checklist for a future
approved native build; keep the existing private registration tables and
trusted-server enrollment path. Synthetic CMS tests, disposable PostgreSQL,
and Linux Swift parsing do **not** substitute for these steps.

**Preflight** — on a real App Attest-capable iPhone (not Simulator) and paired
Apple Watch, with approved temporary staging accounts A and B:

1. Record source commit SHA, Xcode/iOS/watchOS versions, signed iOS bundle ID,
   verified 10-character Team ID, expected app ID, application environment,
   native entitlement, and watch target signing. Do not infer these values.
2. Confirm the temporary staging database has the approved isolated
   enrollment schema, the restricted operator connection, and no client grants
   to attested keys or the private registration writer. Keep production
   untouched and enrollment routes default-off except explicitly authorized
   staging acceptance.
3. Enable only the dedicated protected **staging** enrollment route; record
   operator identity, short-lived access scope, staging-only credentials,
   test accounts, and a cleanup owner. Never print a service key, private key,
   bearer token, actual signed receipt, or raw health data into CI.
4. Sign in as A. Obtain an authenticated, five-minute challenge; verify owner,
   active session, challenge ID, app ID and environment. Generate/load the
   device-protected key and call `attestKey` with SHA-256 of the exact challenge.
5. Submit the real attestation object and key ID. Collect only sanitized
   evidence: receipt SHA-256, leaf certificate fingerprint, challenge ID,
   environment, expected app ID, rejection reason or trust-record count.
   The server must validate Apple-rooted certificate chain, nonce, P-256 key,
   CMS receipt signature and chain, signed payload IDs/client hash, creation
   time, and single-use transactional registration.
6. Verify **exactly one** private key registration owned by A, a consumed
   challenge, zero authorization by direct client SQL/API, and no duplicate
   under an idempotent/replayed request. No client may choose a receipt
   verifier or claim `receiptValid`.

**Required negative scenarios** — repeat with fresh challenges and isolated
keys where necessary; every rejection must leave **zero new registrations**
and must not consume a challenge unless a successful enrollment committed:

| Case | Expected server result |
| --- | --- |
| Missing/truncated CMS, indefinite-length ASN.1, malformed receipt | Reject before private registration |
| CMS signed under unrelated CA, substituted intermediate, expired/not-yet-valid cert | Reject Apple trust chain |
| Same signed CMS with altered payload or signature | Reject signature |
| Correct receipt but wrong Team/bundle app ID, challenge hash, or public key | Reject evidence binding |
| Sandbox AAGUID with production challenge, or vice versa | Reject environment |
| Receipt type `RECEIPT` instead of original `ATTEST` | Reject initial key enrollment |
| Stale (older than 5 minutes), future-dated, or expired receipt | Reject freshness |
| Invalid Auth session, account B using account A challenge | Reject owner/session |
| Duplicate key insert fails after challenge update, or transaction abort after writer | Roll back both key and consumption |
| Concurrent completion of same challenge | At most one registration |
| Watch decline, wrong watch key, replayed watch signature | No pairing approval |
| Revoke, reinstall, watch reset, offline retry | No resurrection or cross-account transfer |

**End-to-end acceptance after enrollment** — watch must require on-device
approval; pairing proof must be bound to registered iPhone key and active
account session. Execute owner A/B isolation, nonce replay, monotone assertion
counter, disconnect/revoke, re-pair, offline resume, and data-ingestion refusal
for revoked devices. Confirm app behavior on a real phone and watch, including
navigation, accessibility and battery impact. Do not weaken default-off gates
to work around a failed native or hosted test.

**Evidence record per scenario:**

```text
ALL-243 scenario:
Build commit SHA / signing IDs (no secrets):
iPhone model + iOS / Watch model + watchOS / Xcode:
Staging project reference (not credentials):
Test account alias A or B / environment:
Challenge ID / receipt SHA-256 / key fingerprint (safe identifiers only):
Expected result:
Observed result and sanitized failure code:
Private key count before/after; challenge consumed before/after:
CI run / device log artifact location (redacted):
PASS / FAIL / BLOCKED; date and reviewer:
Cleanup: routes disabled, credentials revoked, test records removed:
```

A positive result **must** include a genuine Apple-issued attestation and
CMS receipt. A synthetic signed receipt should only be used to prove negative
cases. No native build, physical pairing, hosted enrollment, or production
release is claimed by preparing this protocol.

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
