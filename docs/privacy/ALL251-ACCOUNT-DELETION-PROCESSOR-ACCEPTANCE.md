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
