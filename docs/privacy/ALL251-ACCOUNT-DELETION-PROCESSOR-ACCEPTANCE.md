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
