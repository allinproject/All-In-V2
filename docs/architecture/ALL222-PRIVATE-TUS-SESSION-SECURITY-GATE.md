# ALL-222 / ALL-251 — private Storage TUS session security gate

Status: **BLOCKED / NOT APPROVED FOR PRODUCTION**. This is a staging acceptance
record and design constraint, not authorization to deploy, modify policies,
enable deletion, or open direct client Storage write grants.

## Verified disposable-staging evidence (2026-11-14)

Operator-held signer, genuine GoTrue users A/B, private bucket
`v2-private-workout-objects`, Supabase project `fbtgknlxjyeqrxemskbl`.
The script is `scripts/test-all222-operator-attested-tus-resume.mjs`
(draft PR #25). Never paste signing material, bearer URLs, JWTs, or object
paths into issues, logs, or support tickets.

| Probe | Observed result |
| --- | --- |
| A/B signed attested server ordinary Storage writes | PASS: actual bytes, SHA-256 readback, settled leases |
| A authorized signed capability upload | PASS: actual bytes, SHA-256 readback, settled lease |
| A TUS initial 6 MiB PATCH then HEAD | PASS: exact offset confirmed |
| A TUS resumed remaining bytes | PASS: SHA-256 download and settled lease |
| B HEAD against A's still-active TUS URL | **HTTP 200; Upload-Offset present** — metadata isolation fails |
| B PATCH of exactly next expected byte using B JWT | HTTP 403; **no offset advance** — tested unauthorized mutation blocked |
| A DELETE against completed TUS URL | HTTP 403 |
| A HEAD after DELETE | HTTP 200 — session termination **not demonstrated** |
| Read-only SQL after the test | 0 Auth users, 0 Storage objects, 0 open leases; does not prove TUS transient state absent |

A failed B HEAD check is **not** proof B downloaded/mutated A's object.
A denied B PATCH does **not** prove all privilege/protocol routes denied.
A failed DELETE / successful HEAD after completion is **not** proof that
the object still exists; it leaves cancellation/expiry unresolved.

## Confirmed provider behavior and risks

Supabase's [resumable upload documentation](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
describes unique TUS upload URLs, PATCHing chunks to that URL, and a URL
valid **up to 24 hours**. Our reviewed attested write lease expires after
30 minutes. Do not assume lease settlement revokes all independent provider
upload URLs or that a Storage object row inventory inspects TUS session state.

The hosted provider's precise HEAD/DELETE authorization, termination,
post-completion retention, and stale-session replay behavior is not established
by that documentation; the real negative/positive HTTP outcomes above are
the acceptance evidence. Do not treat unsupported DELETE as cancellation.

## Shipping policy (fail closed; no code bypass)

1. Do **not** offer direct-to-Supabase private TUS initiation, continuation,
   or a bearer upload-session URL in the mobile app. No new `anon` /
   `authenticated` policy, unsigned lease, or service-role exposure is
   allowed as a convenience fix.
2. Continue using the **existing canonical attested server-side writer**
   only where its scoped size, owner, operation, lease, byte readback and
   settlement requirements are satisfied. Server-side operation is not
   evidence of provider exclusivity; further provider route acceptance
   is required before enabling general private Storage.
3. If large private media needs resumption, design a **scoped server-owned
   upload gateway** that authorizes the caller's current real Auth session
   and owner/byte range *on every* HEAD/PATCH/finalize, enforces cancellation
   and deletion lock, binds its session to an explicit expiry, and prevents
   raw provider upload-URL leakage. Reuse the canonical lease authority
   and storage writer/barrier rather than introducing a second source of truth.
   This is an option for design review, NOT an implemented or deployed solution.
4. Test delayed PATCH/HEAD after logout, user deletion lock, JWT rotation,
   lease expiration, account A/B switching, and any capability expiration;
   evaluate B's ability to use a leaked provider URL with/without a JWT.
   Independently test S3/multipart, signed completion, and privileged
   provider REST paths. Any write after a deletion lock is an acceptance failure.
5. Verify TUS-specific session/cancellation/expiration **with actual HTTP
   evidence** and separate Storage/DB cleanup evidence. SQL counts alone
   are insufficient. Operator signer custody stays outside shared GitHub
   Actions secrets and Supabase Edge/project-wide secret inventory.

Release gates stay `uploadBarrierEnforced=false`,
`completePrivateStorage=false`, and operational account deletion **OFF**
until ALL-222/ALL-251 acceptance and independent legal/privacy review.
Do not close the issues or merge the positive-test draft as a PASS.


## Next isolated negative test — stale completion after deletion lock

Prepared: `scripts/test-all222-staging-delayed-completion-after-deletion-lock.mjs`.
**Not yet run; no PASS claimed.** This is a separate operator-only negative
test that does **not** require or receive the attested signer:

- Creates its own real, explicitly tagged disposable `all251-http-*` Auth
  fixture because the existing staging-only account-deletion RPC requires
  that exact verified identity type.
- Pre-mints an unfinished TUS session and an authenticated signed upload
  capability **before** any deletion lock, without granting a write lease.
  The reviewed account-deletion request trigger forbids a new deletion
  request while a lease is open; testing with an open lease would not reach
  the delayed-completion scenario.
- Calls the existing reviewed `v2_all251_http_matrix_request_deletion`
  RPC with the user's real fixture JWT, and requires a confirmed request.
- Attempts TUS completion, signed PUT and ordinary POST after the lock;
  each must deny and have provider-confirmed missing object bytes and
  metadata. Exact HTTP numeric statuses only are recorded, never tokens.
- Uses the existing fixture-only
  `v2_all251_http_matrix_cleanup_deletion` RPC before removing its own
  synthetic Auth user. It records unfinished-provider-session HEAD status
  separately. If TUS session expiry/termination cannot be confirmed, the
  **whole test remains failed** despite database/object cleanup.

Execution requires the already authorized operator's disposable staging
API credentials, `ALL222_STORAGE_HTTP_ALLOW=true`, exact
`ALL251_STAGING_REF` and `ALL251_STAGING_URL`, and `CI != true`.
Do not move the independent signer to CI or into this test.
Run this only from the isolated PR worktree after verifying the exact
latest script commit and running `node --check`; verify staging has zero
unrelated fixtures and open leases first. Do not repeat on failure
without reconciliation of any active upload session or deletion fixture.
