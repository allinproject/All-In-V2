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

## Gateway boundary and method-by-method authorization (design-only)

This is a **review contract, not implemented behavior**. The existing
`createAttestedPrivilegedStorageLeaseAuthority` is the only permitted
authority for beginning, settling and cancelling a lease. Its `cancel`
operation only transitions database state; it cannot be used as evidence
that a third-party TUS URL was terminated.

### Ingress and credential boundary

- Mobile clients may authenticate to an ALL IN 365 controlled endpoint, but
  **must never be handed a raw Supabase private TUS session URL**, storage
  service-role credential, signed writer key or internal provider upload token.
- A protected gateway must terminate client requests and perform current
  owner, session, lease, file scope, range and deletion authorization **before
  each request**, rather than trust the prior authorization at TUS creation.
- Server-to-provider forwarding is allowed only if **all** applicable
  client-accessible direct provider upload paths are denied. A mobile client
  retaining a direct Supabase JWT + provider URL can bypass a gateway's
  per-request decision; a gateway alone is not a security fix.
- Use existing attested lease ownership, exact bucket/path/operation/digest
  scope, the existing owner deletion lock and canonical storage writer. Never
  create a parallel independent lease table or accept client-supplied owner
  identity as authorization.

### Source-controlled authorization policy (not activated)

Draft PR #25 now contains
`supabase/functions/_shared/trainingPrivateResumableAuthorization.mjs`
with isolated tests in
`scripts/test-all222-private-resumable-authorization.test.mjs`.
The pure policy rejects owner/session mismatches, stale Auth sessions,
deletion locks, cancelled/settled/expired leases, foreign paths, wrong
upload offsets and oversized chunks. It refuses all requests unless its
trusted caller supplies both an explicitly proven restricted-provider
ingress boundary and a proven exclusive deletion/cancel/byte-commit
fence. Its authorized receipt contains no provider URL.

**This is not a runnable resumable endpoint.** No server-side source of
authoritative upload-session facts, durable chunk store, provider ingress
isolation, exclusive asynchronous byte-commit locking, or HTTP handler
has been wired. Callers must not infer these controls from boolean
parameters. They must be independently implemented and verified before
the policy is activated. The new tests are synthetic policy tests, not
real provider HTTP evidence. Do not route private mobile uploads through
this module or enable direct TUS while these dependencies are missing.

### Canonical-fence operation wrapper — implemented in source, not active

The review branch now includes
`supabase/functions/_shared/trainingPrivateResumableOperationBoundary.mjs`
and its synthetic regression tests. It rejects construction unless the trusted
runtime explicitly enables BOTH verified restricted provider ingress and a
verified exclusive commit fence. Once configured, the wrapper acquires the
injected existing **canonical per-owner fence**, reads fresh authoritative
Auth/session/lease/deletion state **inside** it, calls the shared per-method
authorization policy, and holds the fence while invoking the trusted provider
operation. Failure or ambiguous proof rejects completion. PATCH requires the
confirmed new offset; CANCEL requires independently confirmed provider-session
invalidation, provider-byte absence and canonical signed cancellation;
FINALIZE requires verified exact bytes and signed lease settlement. Responses
do not contain raw provider URLs or signing material.

**Explicit remaining blockers:** no real durable owner-lock adapter spanning
asynchronous provider I/O has been supplied, no authoritative resumable
session reader/provider session invalidation exists, and no provider ingress
isolation has been accepted. The dependency-injected functions and boolean
flags are **not themselves evidence of a safe lock or real provider denial**.
These staged modules are not imported by an HTTP handler; they do not secure
existing direct Supabase TUS routes. The synthetic tests must be executed
and later replaced/supplemented with hosted concurrency and real HTTP evidence.
Do not enable the endpoint or release deletion on this basis.

### #4 private provider URL exposure guard — draft implementation

PR #25 now extends the existing
`scripts/test-all251-runtime-storage-writer-inventory.mjs` to reject new
direct TUS session creation, raw resumable-upload routes and signed-upload
bearer API calls inside the mobile/Edge runtime source tree. The existing
owner-fenced operation wrapper returns only allowlisted public status and
offset fields, never its trusted provider callback payload. The
`scripts/test-all222-private-resumable-operation-boundary.test.mjs` suite
also asserts that a synthetic malicious provider response containing a
session URL, bearer data, and signing material does not leak in the receipt.

**Important distinction:** source inventory and public response shaping
reduce accidental exposure but **do not restrict direct network access** to
Supabase Storage/TUS. The actual hosted cross-owner TUS HEAD remains an
unresolved provider-side failure. A direct provider URL already known to a
user could still bypass an ALL IN 365 gateway. Do not enable private
resumable uploads until an independently verified provider ingress
restriction or an alternative provider-private storage boundary removes
that path. Direct provider REST, signed capability, S3/multipart, leaked
TUS URL with and without JWT, and expiration/termination all need real
hosted negative acceptance; source tests cannot provide that evidence.
No project policy/grant changes or production deployment are approved.

### Required per-method decisions

| Client action | Precondition before touching provider/session |
| --- | --- |
| CREATE/initiate | Valid current Auth session, owner/path authority, no deletion lock, exact active attested lease, bounded size and expiry |
| HEAD/status | Same current owner/session validation as PATCH; session scope and deletion/cancel/expiry checked; no foreign offset or metadata |
| PATCH/resume | Recheck owner/session/lease/deletion state; permit only expected offset and bounded chunk/total bytes, serialized with cancellation/deletion |
| FINALIZE | Recheck everything, confirm **provider-side exact object bytes and SHA-256** before canonical signed settlement; never settle partial or missing data |
| CANCEL/abandon | Stop further client operations, coordinate provider-session invalidation or durable deny, invoke canonical signed cancel separately from settlement, preserve deletion barrier until provider safety proved |
| EXPIRED/revoked session | Deny HEAD/PATCH/finalize immediately; reject reused capabilities and stale Auth sessions, including a JWT that still cryptographically validates after account/session revocation |

**Atomicity caveat:** checking the DB once before a provider PATCH and then
allowing the PATCH to finish after a deletion lock is a TOCTOU race. The
gateway must use a **demonstrated** lock/serialization or equivalent
provider-side mechanism that covers the asynchronous byte commit boundary.
Do not claim this is solved by a preflight SELECT, an expired lease,
`cancelled_at`, or an eventually consistent cleanup job.

### Required proof before activation

- Reproduce existing B-on-A HEAD exposure with the raw provider route only
  in explicitly approved disposable staging; prove the **new client-facing**
  endpoint denies B HEAD, PATCH and finalize with no offset/bytes leak.
- Prove that B cannot bypass gateway controls through a known provider
  upload URL, ordinary Storage REST, signed URL, S3 or multipart credentials.
  If provider ingress remains reachable with a user credential, do not launch
  private resumable upload.
- Prove active partial-upload cancellation invalidates further provider
  HEAD/PATCH, not just object metadata; independently confirm zero object
  bytes and no surviving writable transient session.
- Race cancellation and deletion lock against an in-flight last PATCH and
  finalize; assert no post-lock byte commit, metadata visibility, or signed
  settlement, including session expiry/logout/account switching.
- Keep direct private TUS and account deletion disabled while any test is
  inconclusive. No hosted configuration or schema change is authorized by
  this document.

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

## Hosted termination fixture reconciliation — operator gate

The operator-only `--terminate-active` probe intentionally **does not
release** an unfinished attested lease on a transient TUS DELETE. The
database Auth-deletion trigger keeps any unsettled lease (including a
cancelled one) as an owner-deletion blocker. This is deliberate until the
provider upload has been independently invalidated. The probe now prints
a **CHECKPOINT / PARTIAL** and exits nonzero while cleanup is outstanding;
a successful DELETE 204 is not an end-to-end acceptance PASS.

The read-only query in
`scripts/fixtures/all222-hosted-termination-fixture-inventory-readonly.sql`
selects only Auth owners tagged `all222_disposable=true` and
`all222_fixture=terminate-active` with the exact synthetic-email prefix.
It inventories all their leases (open, cancelled, settled and
out-of-scope), private workout objects and deletion-request presence.
The query has been checked on the zero-fixture disposable staging
project and returned zero rows; it has **not** been validated against a
populated fixture. It does not read provider TUS transient state and
must not be confused with proof of cleanup.

A second **unexecuted, rollback-only** candidate,
`scripts/fixtures/all222-hosted-termination-cleanup-dryrun-review.sql`,
documents the exact staging-only cancellation-lease reconciliation rules.
It starts with impossible UUID placeholders, holds the canonical owner
lock, requires a tagged synthetic Auth owner, one cancelled/unsettled
attested lease with the expected path and digest, zero other leases,
zero owned private objects, and no deletion request; it always ends in
`ROLLBACK`. It does not delete an Auth user, validate hidden provider
sessions or establish operator sign-off. **It has not been executed on
hosted or populated local fixtures and must not be treated as an approved
cleanup tool.** An actual cleanup still requires separate authorization
and exact provider/session evidence.

**Before any hosted active-session run:**

1. Independently approve a *staging-only* cleanup that is limited to
   the exact tagged synthetic Auth owner and its specific cancelled lease.
   Do not create a generic service-role client deletion bypass or change
   the normal Auth/deletion fencing.
2. Obtain provider evidence for *that* TUS session: DELETE=204,
   subsequent HEAD/PATCH=404 or 410 without offset, privileged object
   download/info explicit `NoSuchKey`, and no surviving physical bytes.
3. Reconcile under the canonical owner advisory lock after verifying
   the exact tagged owner, lease UUID, path, digest, no other unresolved
   leases, zero owned private objects and no deletion request. An
   interrupted or ambiguous cleanup must remain blocked for operator
   inspection. Never delete another user's lease to make a test green.
4. Remove only the approved synthetic lease with a separately reviewed,
   audited administrative action, then delete the matching synthetic
   Auth account through GoTrue Admin and confirm absence and no residual
   objects/leases. Re-run the stale provider-session check afterward.
5. Only after independent verification of every checkpoint may a
   completed hosted acceptance result be recorded. The current test
   script has no approved automated cleanup adapter, so **do not run
   it merely to get a green result**.

The staging provider network check still requires the operator-held
private signer and separate credentials; no secrets should go into
GitHub Actions, Edge project-wide settings, docs or chat. Cross-owner
raw-TUS HEAD metadata leakage remains a known failing gate, independent
of the above termination path.

## Operator-only active termination probe

The disposable staging cancellation migration is installed. Confirm there is
an approved way to remove the tagged synthetic fixture before running this
mode. The cancellation fence deliberately keeps a cancelled lease unsettled,
so automatic Auth deletion is skipped for this probe. Keep the fixture for
reconciliation if any step fails. Avoid reruns until the previous fixture
has been reconciled.

Load the existing operator signer and disposable staging keys privately.
Use the pinned `ALL251_STAGING_REF` and `ALL251_STAGING_URL`, set
`ALL251_OPERATOR_APPROVED=true`, then acknowledge the manual cleanup in
`ALL222_TERMINATION_FIXTURE_CLEANUP_ACK=true` and run:

```sh
node scripts/test-all222-operator-attested-tus-resume.mjs --terminate-active
```

The probe requires a 6 MiB partial upload and exact owner offset, DELETE
204, explicit session absence on HEAD and PATCH, and explicit object byte
and metadata absence before requesting signed cancellation. It reports HTTP
statuses without identifiers or session URLs. An acknowledged cancellation
covers this termination probe only. Separately inspect and reconcile the
`all222_fixture=terminate-active` synthetic owner and lease in staging.
