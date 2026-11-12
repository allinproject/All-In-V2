# ALL-251 — V2 account deletion processor acceptance

**Status: REQUEST/CANCEL/CLAIM INFRASTRUCTURE IMPLEMENTED; DESTRUCTIVE PROCESSOR NOT IMPLEMENTED OR ENABLED.**  
**Scope:** V2 only, project `xarhuczrtzuiljmtdaeu`, branch `integration/v2-foundation`. Do not touch V1 or `main`.  
**Owning issue:** [ALL-251](https://linear.app/allin365/issue/ALL-251/v2-profile-privacy-and-account-lifecycle-preferences-export-deletion).

## Implemented canonical lifecycle

`Profile → Account → Delete account` has owner-checked request submission and status display with typed confirmation. A request is stored in `allin_private.v2_account_deletion_requests` with a new `request_id` and `requested` status. The owner can cancel only the exact `requested` ID (a cancelled/rejected request can be resubmitted with a fresh ID). Cancellation and service-only processing claims use the same per-owner advisory transaction lock and row lock. The service-only `v2_claim_account_deletion_for_processing` RPC accepts only `requested` → `processing` and requires exact owner/request IDs.

**Default-off privileged release switch:** `allin_private.v2_account_deletion_processor_config.execution_enabled=false`. The config has RLS enabled and no direct grants to `anon`, `authenticated` or `service_role`. The claim RPC is executable by `service_role`, not `anon` or ordinary `authenticated`, but **fails even for the service role while the switch is off**. Do not enable until implementation and release acceptance are complete.

**Fail-closed data coverage:** The processing claim also denies any V2 Storage bucket and any `public`/`allin_private` table with a live `user_id` column lacking a direct `ON DELETE CASCADE` foreign key to `auth.users`. These checks are conservative guardrails, not proof of third-party data or indirect-owned data deletion. When V2 adds progress photos, imported media, Coach conversations, nutrition logs or indirectly linked records, expand the owning processor and coverage test *before* enabling it; do not remove the guard merely to allow processing.

## Live V2 inventory, 2026-11-11

- Auth accounts: **0**. Deletion requests: **0**. V2 Storage buckets: **0**.
- Current direct user-owned relations with `ON DELETE CASCADE`: `allin_private.v2_account_deletion_requests`, `v2_health_considerations`, `v2_onboarding_actions`, `v2_profile_settings_actions`, `public.v2_legal_acceptances`, `v2_onboarding_progress`, `v2_profile_settings`, `v2_profiles`.
- No deletion processing worker/Edge Function is active, and no account/data has been deleted in these tests.
- Supabase advisor: intended private-table `rls_enabled_no_policy` informational findings; signed-in callable SECURITY DEFINER RPC warning requires continuing owner/permission evidence. [Security advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Verification evidence

1. Simulated authenticated foreign-owner deletion/read and invalid-confirmation cases: rejected.
2. Service-only claim: `authenticated` EXECUTE denied; `service_role` EXECUTE granted.
3. Pending cancellation versus processing claim: [rolled-back synthetic Auth/requests test](../../supabase/tests/all251_claim_cancel_ordering_rollback.sql) passed both possible serial orders, including default-OFF switch rejection before a **transaction-local** test override. This does not constitute a true two-session race test.
4. [Rolled-back coverage guard test](../../supabase/tests/all251_claim_coverage_guards_rollback.sql): adding a synthetic Storage bucket blocks the claim; adding a synthetic uncascaded owner table blocks the claim. Both tests passed; all fixtures were rolled back.
5. Rechecked live project afterward: gate OFF, 0 accounts, 0 requests, 0 buckets, no test-only table.

## 2026-11-11 — Staged worker source and durable execution receipts

**The worker implementation exists in source but is NOT DEPLOYED. Execution remains OFF.** Source: [v2-account-deletion-worker](../../supabase/functions/v2-account-deletion-worker/index.ts). No Edge Function is deployed in V2 and no scheduler is connected. The worker demands all of:

- POST with only exact lowercase canonical `user_id` and `request_id` UUIDs.
- A separately configured worker-token secret (min 32 chars) in `x-allin-worker-token`; no browser CORS flow and no client credentials.
- `ALLIN_DELETION_WORKER_ARMED=true` (absent/unset is disabled).
- The existing **privileged, private** V2 database processing gate `execution_enabled=true` (currently false). The claim still checks storage/owner data coverage and exact non-cancelled request.
- Exact service-only claim RPC, then `auth.admin.deleteUser` (hard deletion, never soft-delete), independent Auth absence check, and service-only completion receipt. Any uncertainty is written to a generic, non-PII failure status and requires manual review; no automatic destructive retry.

**New durable audit schema:** `20261111124645_v2_deletion_durable_minimal_execution_audit_and_receipts.sql`. `allin_private.v2_account_deletion_execution_audit` contains only request UUID, temporary user UUID while unfinished, status, generic failure code and timestamps. It has RLS and no direct user/service-role table grants. The exact-request claim inserts an audit row atomically with the `requested → processing` transition. The service-only completion RPC verifies that Auth user and deletion request are absent before marking completion and scrubbing user UUID; failure RPC records constrained generic codes. This record survives the Auth foreign-key cascade; legal retention/expiry and notification policy still need approval. The existing claim's conservative user-data coverage preflight deliberately excludes the audit table itself.

**Executed tests:** rollback-only SQL confirms default-off claim denial, audit creation on claim, premature completion rejection while Auth user exists, Auth request cascade, and durable redacted completion after synthetic Auth deletion. Separate rollback-only failure test confirms constrained failure statuses and rejects free-form failure messages. [Success-path regression](../../supabase/tests/all251_execution_audit_rollback.sql), [failure-path regression](../../supabase/tests/all251_execution_failure_audit_rollback.sql). The worker policy tests [policy.test.mjs](../../supabase/functions/v2-account-deletion-worker/policy.test.mjs) pass 3/3 under Node 22.16 with `--experimental-strip-types`; exposed as V2 mobile `test:deletion-worker`. No function has been deployed or invoked with a real Auth Admin credential, and **no real account/data was deleted**.

**Critical review still needed before deployment:** verified caller auth model/secrets and isolated deployment environment, end-to-end Auth Admin result contract, actual worker exception handling and retry strategy, true concurrent request/cancel/claim test, signed-in 2-account app tests, Storage/provider cleanup expansion as V2 gains these domains, audit retention and privacy notices, sign-out/session behavior, legal/founder approval and external iPhone/TestFlight acceptance. Do not consider an undeployed function production-accepted merely because pure policy and SQL tests pass.

## 2026-11-11 — Deletion orchestration failure-path hardening

The staged worker's claim, Auth deletion, Auth absence readback, completion receipt and generic failure audit have been extracted from the Edge request handler into the pure injectable [execution module](../../supabase/functions/v2-account-deletion-worker/execution.ts). The [Edge handler](../../supabase/functions/v2-account-deletion-worker/index.ts) maps its result to the HTTP response. A deletion is attempted **at most once** after an exact matching `processing` claim receipt; rejected, thrown or mismatched claims cannot trigger an Auth deletion. An unknown HTTP 404 does **not** establish a deleted Auth user: absence requires the specific `user_not_found` API error code **and** status 404. If the Admin API returns an ambiguous network error, the account still exists, the absence check fails or the audit completion receipt is invalid, the worker requires manual recovery. It never sends a second destructive request.

[Eight locally executed Node 22 unit tests](../../supabase/functions/v2-account-deletion-worker/execution.test.mjs) passed: normal completion, failed/thrown/mismatched claims, ambiguous delete response, unrelated 404 from Auth lookup, user still found, database completion error, malformed completion receipt, and failure-audit write error. Added the execution test alongside the original policy suite in the V2 `test:deletion-worker` script. This is **mocked orchestration**, not proof of live Auth Admin/Edge execution or a production build.

[Supabase function configuration](../../supabase/config.toml) explicitly specifies `verify_jwt = true` for the staged worker, in addition to its internal long-secret worker token and its two default-off activation switches. **Do not deploy or enable the function until the exact service-to-Edge JWT authentication path, secret provisioning and secure triggering mechanism have been exercised in an isolated environment.**

**Remaining blocker:** manual recovery from uncertain Auth deletion is not yet an accepted operational procedure. A missing Auth account with a failed audit cannot be retried via the normal claim path (by design); operator recovery must first verify all data/Storage/provider cleanup and preserve an approved minimal audit before recording completion. No automatic retry should be added to work around this safeguard. Verify signed-in token revocation, full Expo typecheck, device, genuine two-account and real two-session concurrency tests.

## 2026-11-11 — Ambiguous Auth result reconciliation

The staged worker now **always attempts one read-only `auth.admin.getUserById` check after its single `auth.admin.deleteUser` attempt**, regardless of a successful response, error response or thrown timeout. There is **no second deletion call**. Only the exact `user_not_found` error code with HTTP 404 is accepted as definitive absence; an arbitrary 404 or timeout is not enough. Even after confirmed absence, the worker returns success only for an exact matching completion receipt from the existing service-only database RPC. Otherwise it records generic failure evidence and requires manual operator recovery.

- [Updated pure execution module](../../supabase/functions/v2-account-deletion-worker/execution.ts), [12 committed mock regression cases](../../supabase/functions/v2-account-deletion-worker/execution.test.mjs). A local Node v22.16 replay of the current execution algorithm passed **12/12 tests**, including claim rejection, non-retry after ambiguous deletion, confirmation of an actually deleted Auth user after network failure, unrelated 404, unknown state, and completion receipt exceptions. Full Expo/CI and live Supabase Auth Admin behavior have **not** been validated.
- [Rollback-only failed-audit reconciliation SQL](../../supabase/tests/all251_reconcile_failed_audit_rollback.sql) executed successfully in V2: premature completion rejected while synthetic Auth account existed; after synthetic Auth deletion, the existing completion RPC converted a failed audit into minimal, redacted `completed` evidence. All writes rolled back.
- **Manual operator procedure (not automated):** identify the exact request UUID and the owner's pending audit UUID; verify owner identity and original request against preserved approved evidence; check independently whether the Auth account, request, all owned database data, Storage/media and external-provider data are gone; verify legal retention/hold and user-notice obligations; only then use the existing **service-only** `v2_record_account_deletion_completion` RPC to reconcile a failed audit when Auth and request truly are absent. If ANY data/identity state is uncertain, preserve failed status, do not retry an Auth deletion, and escalate. No manual use is authorized on a real account until privacy/security release signoff.
- This is a safer uncertainty handler, not real iPhone, external processor or production deletion acceptance. The private execution gate remains OFF.

## 2026-11-11 — Completion checks now reject leftover data

Added V2 database migration [`20261111130824_v2_deletion_completion_verify_auth_sessions_and_owner_rows.sql`](../../supabase/migrations/20261111130824_v2_deletion_completion_verify_auth_sessions_and_owner_rows.sql), applied in live V2 and mirrored from its actual migration ledger. The service-only completion receipt now refuses success if the Auth user still exists, any `auth.sessions` row remains for that user, any Storage bucket exists without approved coverage, or **any current** `public`/`allin_private` table with a direct `user_id` column (excluding the intentionally preserved audit row) still contains that user's data. The table list is evaluated when completion runs, protecting against newly added user-owned tables. These checks are deliberately conservative; they do not prove all indirect links or third-party processors were cleaned up. Keep the worker undeployed and processing switch OFF until broad deletion coverage is accepted.

A [rollback-only synthetic orphan record test](../../supabase/tests/all251_completion_orphan_guard_rollback.sql) passed: an Auth account was removed inside the transaction while one uncascaded owner row remained; completion was rejected. After removing the orphan, the completion receipt succeeded and redacted the audit owner. The transaction then rolled back completely. Final V2 checks: **no Auth accounts, deletion requests, audit records, Storage buckets, or synthetic tables; processing gate OFF; no deployed Edge Functions**.

**Remaining unverified release items:** a genuine isolated two-session concurrent race, real Auth Admin API integration, true installed-iPhone flow and account swap, stale JWT/session access after deletion, retention/notification privacy decisions, and legal/founder acceptance. Do not infer session invalidation merely because the Auth session row is gone: previously issued JWTs can remain valid until expiration, so guard all sensitive server operations appropriately.

## 2026-11-11 — Stale JWT account-existence protection

**Applied to live V2:** [`20261111131212_v2_stale_auth_token_account_existence_guards.sql`](../../supabase/migrations/20261111131212_v2_stale_auth_token_account_existence_guards.sql) preserves nine existing owner SECURITY DEFINER RPCs, adding a check that `auth.uid()` still corresponds to an `auth.users` row. Applies to Profile read/settings, onboarding, health read/write, legal acceptance and deletion request/status/cancellation. The owner ID in a previously issued JWT alone is insufficient after Auth deletion.

**Verified:** [rollback-only SQL regression](../../supabase/tests/all251_stale_jwt_owner_rpc_rollback.sql) showed a synthetic account using Profile normally before deletion and all nine owner RPCs rejecting its simulated still-valid JWT after the Auth user row was removed. The saved test file was executed successfully; all synthetic changes rolled back. Live DB readback confirmed nine guarded functions, no accounts, requests, audits or Storage objects and processing switch OFF.

**Remaining:** this is not global token revocation. Future new RPCs, Edge Functions, Storage access, and Coach must also enforce current account/session validity; verify with real authenticated two-device and expired-token tests. Isolated Auth Admin and true concurrent transaction validation, iPhone acceptance, external deletion coverage and legal/founder signoff remain outstanding. No worker deployed or external signup enabled.

## 2026-11-11 — Two-owner rollback and independent-session race harness

**Executed and passed in V2:** [two-account owner isolation SQL](../../supabase/tests/all251_two_account_owner_isolation_rollback.sql). Inside one rolled-back transaction, synthetic authenticated Account A could not read, cancel, or submit Account B's deletion request. A cancelled its own request, resubmitted and received a new request UUID; the old UUID could not cancel the new request. B's request remained untouched and B could independently cancel its own request. No real users or request records were retained.

**Staged but NOT EXECUTED:** [true two-connection concurrency harness](../../supabase/tests/all251_true_two_session_race.cjs). Requires the `pg` Node dependency, `ALL251_TEST_DATABASE_URL` pointed at a loopback PostgreSQL database with name ending `_test` or `_isolated`, and explicit `ALL251_ISOLATED_TEST_DB=YES_DISPOSABLE`. It creates only disposable Auth users and runs both deterministic interleavings with **independent connections**: claim first must block then reject cancellation; cancel first must block then reject claim. It restores the processor release gate in cleanup, including cleanup-error paths. **Do not run against live V2, a port-forward to live V2, or shared data.** It mutates the disposable test database and needs independent review/test execution. It is not proof until a real two-connection PASS log is captured.

The production Supabase connector independently issued two lock checks, but request times were serialized by the connector; that run is **not counted as independent-session race evidence**. A disposable database or approved isolated clone is still required for authoritative concurrency acceptance. Worker remains undeployed with execution OFF.

## 2026-11-11 — True concurrency harness preflight hardened

The [independent-session race harness](../../supabase/tests/all251_true_two_session_race.cjs) remains **NOT RUN**. Its executable source now verifies three distinct PostgreSQL backend process IDs, refuses nonempty disposable databases (any Auth users, deletion requests, execution audit, or Storage buckets), and observes `pg_stat_activity.wait_event_type='Lock'` with `wait_event='advisory'` on the losing backend before releasing the winner. This makes an unverified 175-ms sleep insufficient to report a race PASS. It also retains `localhost/127.0.0.1` and `*_test/*_isolated` target checks, an explicit opt-in, an 8-second statement timeout, and a `finally` path that restores the original processing switch even after fixture-cleanup errors. The saved CommonJS code passed a JavaScript parse check.

**Actual race PASS evidence still missing.** Neither this chat environment nor the V2 Supabase tool has a disposable local PostgreSQL instance and independent SQL session execution. Do not connect this harness to live V2 or to a production port-forward; run it only on a reviewed isolated database containing the exact V2 migrations, and record both backend IDs, SQL assertions, cleanup and switch-restoration evidence. This is a staged test artifact, not execution proof.

## 2026-11-11 — Lost completion receipt readback

Added service-only, read-only [`v2_verify_account_deletion_completion`](../../supabase/migrations/20261111133540_v2_deletion_completion_readback_after_ambiguous_receipt.sql), applied to V2. It returns only an exact request UUID and a `completed/not_completed` status from the minimal redacted audit; it cannot delete or edit data, and `anon`/`authenticated` cannot execute it. This lets a worker which **already verified Auth absence** recover from an ambiguous final completion RPC response, rather than incorrectly recording manual failure despite completed erasure. The worker does not retry Auth deletion or completion mutation. An absent, failed, pending or mismatched request ID never proves completion.

The [saved rollback SQL regression](../../supabase/tests/all251_completion_receipt_readback_rollback.sql) executed successfully against live V2: pending and failed records reported `not_completed`; authenticated owner execution was denied; after simulated Auth removal and service-only completion, the redacted audit reported `completed`; an unrelated UUID remained `not_completed`. All synthetic changes rolled back.

The staged [worker execution module](../../supabase/functions/v2-account-deletion-worker/execution.ts) and [handler](../../supabase/functions/v2-account-deletion-worker/index.ts) now use that readback. The current [15 committed test cases](../../supabase/functions/v2-account-deletion-worker/execution.test.mjs) were replayed against the current source's JavaScript execution body in an isolated V8 evaluation with mocked dependencies: **15/15 PASS**. This does not constitute Expo/Node CI, Supabase Edge deployment, or actual Admin API validation. It does validate the source's control flow with the committed cases.

The [true two-session race harness](../../supabase/tests/all251_true_two_session_race.cjs) was additionally hardened to validate its target before loading the optional PostgreSQL `pg` package, and to close already-open connections when connecting a subsequent backend fails. That race test is still **NOT EXECUTED** because no disposable local PostgreSQL engine is available in this environment.

**Release gate unchanged:** worker not deployed or scheduled; V2 deletion processing OFF, external signup/legal publication closed. Remaining real Auth Admin, true independent PostgreSQL concurrency, end-to-end multi-device/JWT, iPhone/build, retention/notice/legal acceptance.

## 2026-11-11 — Owner-scoped data export foundation

ALL-251 also owns **data export**. Applied [`20261111134456_v2_owner_bound_current_data_export_snapshot.sql`](../../supabase/migrations/20261111134456_v2_owner_bound_current_data_export_snapshot.sql), adding `public.v2_export_my_account_snapshot(p_expected_user_id uuid)` as an owner-verified, authenticated-only current-schema JSON snapshot. It independently verifies the active Auth user exists and matches the exact expected owner. It includes available V2 Auth account basics (not secret hashes/tokens), profile, settings, onboarding, legal acceptances, opt-in health considerations, owner action logs, deletion request and unfinished deletion audit. It **refuses** to run if any future `user_id`-owned V2 table is not part of the explicitly reviewed export coverage, if a Storage bucket exists, or if the inline response exceeds 5 MB. Those failures demand an export-capable workflow rather than silently omitting data.

The saved [rollback owner-isolation and future-table coverage test](../../supabase/tests/all251_account_export_owner_coverage_rollback.sql) executed successfully on V2: Account A's snapshot contained its own profile/email and not Account B's details; A could not request B's export; a stale JWT after deleting A's Auth user was denied; and an extra uncovered user-owned table prevented export. All synthetic changes rolled back. The corresponding RPC is declared in `apps/mobile-v2/src/types/database.types.ts`.

**NOT YET USER-DELIVERABLE:** no FileSystem/Sharing dependency currently exists in `mobile-v2`, and this change did **not** add a Profile export button, write sensitive snapshots to device storage, or claim downloadable file support. Before a real user-facing export, implement secure file delivery with device-owner/session checks, size/streaming handling, protected temporary files and cleanup, media/third-party and indirect-owner coverage, safe screen UX/confirmation, iPhone acceptance and privacy approval. The function deliberately returns an error as V2 grows until those domains are reviewed.

## 2026-11-11 — V2 native JSON file export and privacy actions

The first user-facing [Profile → Account → Export My Data](../../apps/mobile-v2/app/profile/account-export.tsx) screen is implemented on the V2 integration branch. It reads the existing owner-verified `v2_export_my_account_snapshot` RPC after a two-stage confirmation and checks the current session **before and after** fetching personal data. A further owner/mount check occurs after the temporary file is written and before file preview. Account changes remount the screen by authenticated session-generation key. It does not bypass server authorization.

**Current native file flow:** Uses Expo SDK 58 `expo-file-system` `File(Paths.cache,...)`, `file.create()`, awaited `file.write()`, and native `file.preview()` to create an actual temporary `.json` file. The package was **already present at `58.0.13`** in the canonical V2 npm lockfile, and was made a declared direct dependency with synchronized root lock entry; no unrelated dependency update. Native preview is offered on iOS/Android, not web. Viewer saving/sharing behavior and device/platform-specific file handling still require installed-device acceptance. **This is a real JSON file preview, not a guaranteed permanently saved download or a full archive**.

**Privacy and cleanup:** The user is told that the temporary cache file is unencrypted and contains sensitive data, including optional health information. No file is generated without confirmation, no recipient is chosen automatically, and there are no external uploads. [`accountExportFile.ts`](../../apps/mobile-v2/src/features/profile/accountExportFile.ts) cleans up partial files after authorization/write/preview errors and keeps a successful file until the viewer can use it. The screen exposes an explicit **Remove temporary export file** action, cleans up on unmount/account switch, and the [V2 root layout](../../apps/mobile-v2/app/_layout.tsx) removes an abandoned export file on the next app launch. It uses a fixed, app-owned cache path only; never deletes arbitrary device files. Runtime crash/device semantics still require testing.

**Defensive validation:** [`accountExport.ts`](../../apps/mobile-v2/src/features/profile/accountExport.ts) checks schema version, exact account owner, expected section presence/shape, all nested `user_id` records and collection entries for owner mismatch, and a bounded one-million-character JSON limit. The backend has a separate 5 MB inline-size limit and fails closed on unreviewed user-data tables or Storage buckets. Export is therefore deliberately incomplete as new domains are built until reviewed coverage is added; media, third-party data and large-streaming export remain future slices.

**Executed tests:** The eight committed validator cases in [`accountExport.test.ts`](../../apps/mobile-v2/src/features/profile/accountExport.test.ts) and six native-file lifecycle test cases in [`accountExportFile.test.ts`](../../apps/mobile-v2/src/features/profile/accountExportFile.test.ts) passed in isolated source-level JS evaluation, including wrong owner/nested owner, shape, oversize, write/preview failure, owner swap after writing and temporary-file cleanup. Both suites are registered in V2 `test:auth`. **A full npm/Expo TypeScript test run and native iPhone/Android file-preview acceptance remain unverified.**

**Privacy rights before onboarding/terms:** The [export](../../apps/mobile-v2/app/profile/account-export.tsx) and [deletion](../../apps/mobile-v2/app/profile/account-deletion.tsx) screens require active authenticated ownership but do not force pending legal acceptance or onboarding. Links to both appear from the [legal acceptance](../../apps/mobile-v2/app/legal-acceptance.tsx) and [required onboarding](../../apps/mobile-v2/app/onboarding-required.tsx) screens. The [deletion screen](../../apps/mobile-v2/app/profile/account-deletion.tsx) distinguishes request, processing, completed and cancelled states and allows sign-out when status retrieval fails. Other app screens retain their normal access gate.

**Remaining release gates:** Installed native file preview and save/share acceptance, cleanup verification on iPhone/Android and crash/restart, full typecheck and installed upgrade tests, streamable archive of all indirect/media/provider data as those models arrive, legal/privacy review and user notices, isolated Auth Admin deletion and two-session races, and explicit founder approval before enabling destructive processing. Keep the V2 deletion processor and signup closed until accepted.

## The actual deletion processor must still do all of the following

1. Trusted server-side authentication and authorization; never expose service key/admin deletion to mobile clients. No silent scheduled claims or broad user enumerations.
2. Exact owner/request claim after reconciling any updated/cancelled status; a true concurrent cancellation-versus-claim two-session test.
3. Before changing account data, independently inventory **all** owned records, indirect data and Storage objects, external provider integrations and lawful retention exceptions. Private media must be removed through the supported Storage API, not SQL `DELETE` of Storage metadata. No orphaned objects.
4. Define durable minimal completion/failure evidence and retention policy so auth cascade deleting the request row does not erase all operational proof. This requires reviewed privacy obligations; do not invent a retention period.
5. Handle failure and retries without double-deleting, deleting another account, or allowing a stale request to delete a recreated/superseding account. Distinguish `processing` from `completed` only on verified Auth, database, media and relevant integration deletion. Avoid permanently stuck requests.
6. Revoke/expire sessions appropriately; verify token/session behavior, sign-out and account-recreation boundaries.
7. Notify the user by an approved communication path, provide status/receipt before access ends where appropriate, and handle identity verification, legal holds and exceptional support.
8. Automated behavioral tests, true concurrent race test, authenticated two-account tests, network failure/lost-response tests, installed iPhone/Expo acceptance and legal/privacy/App Store review.
9. Obtain explicit founder and human legal/privacy signoff, then independently authorize the processing switch after release checks. **Do not switch it on by merely merging source.** Keep V2 legal publication and external signup closed until their separate gates pass.

## Migration provenance

- Request intake: `20261111120805_v2_owner_verified_account_deletion_request_intake.sql`
- Cancellation: `20261111121605_v2_owner_bound_deletion_request_cancel_before_processing.sql`
- Service claim: `20261111123133_v2_service_only_deletion_processing_claim.sql`
- Default-off gate: `20261111123642_v2_account_deletion_processor_default_off_gate.sql`
- Future-schema coverage guards: `20261111123939_v2_deletion_claim_fail_closed_storage_and_owner_coverage.sql`

Every listed migration was applied to V2, copied from the actual Supabase migration ledger into this branch, and checked. There is **no** general-purpose cascade deletion worker or active recurring job.

## 2026-11-12 — Community and Fuel owner-cascade review

**Review-only, rollback-only:** the existing ALL-251 foundation acceptance fixtures now
cover the four prospective Fuel owner tables and the indirect Community post owner
chain without activating any destructive deletion service.

- `scripts/test-all251-food-log-export-projection-local.psql`: exact ALL-247
  review schemas; synthetic Auth account C owns one Food event, one hydration
  event, and one action receipt in each private ledger. Local Auth deletion
  must cascade all four rows; Account A/B fixtures must remain intact and
  `execution_enabled=false`. Full `ROLLBACK` restores the isolated database.
- `scripts/test-all251-community-post-export-projection-local.psql`:
  exact ALL-244 post source; synthetic Auth C owns one private post through
  `public.v2_profiles(user_id)`. Local Auth deletion must remove the profile
  and post while retaining A/B posts and the worker OFF switch. Full
  `ROLLBACK` restores the isolated database.

**Important limitation:** these tests verify database FK cascades in
disposable PostgreSQL, not an authenticated production deletion, storage cleanup,
worker orchestration or legal retention. The **currently applied deletion
claim/completion preflight primarily enumerates `user_id` columns**. It does
not by itself verify every alternate owner, recipient, actor or relationship
column (for example `owner_id` in Community), nor does it prove cleanup of
orphaned private files or third-party relationship privacy. Release acceptance
must extend the existing canonical claim and completion coverage to reviewed
indirect owner graphs, while preserving the default-off processor and existing
audit/retention system. Do not modify historical applied migrations or enable
deletion processing merely because the cascade fixtures pass.
