# ALL-251 — Lowest-cost secure private Storage boundary (review only)

**Status:** Proposed architecture, NOT deployment authorization. Account deletion
OFF; `uploadBarrierEnforced=false`; ALL-222 and ALL-251 release gates retained.
This is a decision record for review, not a migration or a claim of provider
acceptance. Do not create a Cloudflare account, bucket, Worker, API token,
Supabase RPC, project or any billing resource from this document.

## Threat and non-negotiable result

The app must be able to record A's deletion request while B continues uploading.
After A's request, no new A private bytes may be committed by *any* enabled
upload route. Pre-request delayed uploads must either finish under a durable
lease that blocks deletion or be rendered incapable of committing.
An ordinary user, a stolen ordinary JWT, another existing Supabase Edge
Function, a privileged S3 key, a signed URL, a TUS session, and a multipart
completion must not be a path around the barrier. Operator/admin
compromise is a separately managed trust and recovery threat, not proof
that an application upload route is safe.

A rejection proves deletion enforcement only when the same route had a
successful byte-readback positive control before the request. Missing
credentials, blanket-denied Storage, zero policies, or unsupported routes
remain **RESTRICTED/UNTESTED**, not PASS.

## Evaluated options

| Path | Incremental infrastructure | Writer custody | Principal obstacle | Decision |
| --- | --- | --- | --- | --- |
| Existing single Supabase project, lease/HMAC review SQL | No new provider | HMAC can protect lease RPCs, but Edge secrets and injected secret/service credentials are project-wide | Storage service-role and generated S3 credentials bypass RLS; alternate signed/TUS/S3 routes and shared-secret consumers are not exclusively fenced | **Retain restrictions and review-only candidate; not release-acceptable as an exclusive byte barrier** |
| Existing project with user-JWT Storage RLS | No new provider | Per-user JWT and RLS can scope ordinary uploads | Privileged service keys, generated S3, and signed or in-flight operations remain outside the user-JWT RLS proof | **Useful least-privilege defense-in-depth, not sufficient for privileged deletion assurance** |
| Separate Cloudflare Worker with private R2 bucket binding and isolated signer | Existing Supabase Auth/DB plus optional external service; no extra Supabase project | R2 bucket bound only to trusted Worker; no R2 S3 write tokens issued to other runtimes; HMAC held only in Worker and private DB | Requires new provider setup, billing review, Worker Auth/runtime security, independent operations/recovery, migration and real hosted tests | **Preferred lowest-cost candidate for separate review, not yet approved to provision** |
| Another managed Storage project/account | Additional hosted project or provider | Credentials may be isolated with correct IAM and access boundaries | Incremental baseline fees, operational burden and same-project bypass if roles are not really isolated | Fallback only after actual cost and custody review |

Supabase's documented generated S3 access keys can access all buckets and
bypass Storage RLS. User-session S3 tokens are RLS-scoped, but their success
does not establish privileges of generated keys. Supabase hosted Edge
Function secrets are shared within the project. References:
- https://supabase.com/docs/guides/storage/s3/authentication
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/functions/secrets

## Preferred candidate boundary (no deployed code)

```text
mobile authenticated client
        |
        | JWT only, no service key / R2 binding / S3 master credential
        v
private Worker API (independently administered)
        | validates Supabase JWT, active session, and verified owner
        | restricts permitted bucket, path, method, body size, content type
        | possesses private writer HMAC; all other Edge functions do not
        | takes durable attested lease in existing Supabase DB
        v
R2 bucket binding only in trusted Worker
        | conditional create / compare-and-swap replacement
        | read back exact bytes
        v
attested settlement in existing Supabase DB
```

A deletion request takes the existing advisory-lock owner lifecycle
transition; new lease acquisition fails for A. Any prior issued lease
remains unresolved until its write is byte-verified/settled or a separately
reviewed recovery procedure proves the operation cannot finish. A stale
operation cannot cause successful deletion by simply timing out.

This **extends** `createPrivilegedStorageWriter` through its existing
`storage.from` adapter seam. The non-deploying
`all251R2StorageReviewAdapter.mjs` implements that seam for one private
bucket binding. Its create uses atomic `etagDoesNotMatch: '*'`; replace
uses an ETag compare-and-swap. It never decides who the owner is or
receives raw client-controlled `verifiedOwnerId` as authority.
Auth/session validation, request ingress limits and attested lease
coordination belong to the trusted Worker request handler, which is
**not implemented or deployed by this review**.

Do **not** expose direct R2 object writes, S3 credentials, upload-capable
presigned URLs, or generic Cloudflare admin credentials to the app,
Supabase Edge functions, GitHub PR CI, or untrusted clients.
Prefer a Worker bound to R2 over generated API keys. Do not assume a
Cloudflare Worker with broad R2 permission is safe if untrusted code,
routes, service bindings or privileged operators can invoke writes.

Large data/multipart is deferred until its start, chunks, completion and
abort are bound to a durable owner-specific lease and have a tested
deletion fence. No early-minted direct upload URL can bypass the Worker
at completion. Client-side signed or TUS uploads are **not** supported
by this architecture until explicit secure adapters and real negative
evidence exist. Tests retain them as blocked/untested rather than passing.

## Cost boundaries (2026-11-13 published rates, not a billing promise)

Cloudflare R2 Standard currently lists 10 GB-month stored, 1 million
Class A operations and 10 million Class B operations free monthly, with
zero internet egress charge. Above allowance, Standard storage lists
$0.015 per GB-month, Class A $4.50/million and Class B $0.36/million.
Workers Free currently lists 100,000 requests/day with free-plan
compute limits. See:
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

**No monthly cost is asserted** until actual usage, plan, any billing
activation/payment requirements, log/egress/API overhead, upload sizes,
retention and account-closure costs are reviewed. R2 enrollment and
enabling billing are **not approved** by this document. Existing
temporary staging must be retired after its dependent acceptance work
according to its current deletion reminder.

## Required pre-provisioning sign-off

1. Owner approves service/billing activation and a defined monthly cost
   cap after comparing free limits, account requirements and expected
   beta workload. No paid resources created without express approval.
2. Confirm separate Cloudflare account controls, strong MFA,
   restrictive deployment permissions, independent Worker secret
   custody, no S3 write tokens, narrow R2 bucket binding and
   environment separation.
3. Threat-model Worker JWT validation (JWKS, issuer, audience, expiry,
   session revocation, owner mapping), request-size and rate limits,
   errors/log redaction, unauthorized cross-account writes and reads,
   backup/export retention, and operator key rotation.
4. Review existing Supabase attested RPCs for exactly scoped privileges;
   confirm RLS/GRANT isolation of the key and nonce ledger; design a
   transaction-safe rollback that never regrants unsigned leases.
5. Prove a consistent DB + R2 snapshot recovery boundary, object
   inventory, content SHA-256 and ownership, orphan/resumable detection,
   deletion worker outcome and rollback from partial deletions.
6. Verify protected GitHub staging environment, required reviewer,
   branch policy, bypass setting and secret scopes. A protected CI
   secret is **not** by itself provider-level writer isolation.

## Hosted acceptance plan (explicitly not run)

On an approved isolated staging deployment: create two synthetic users;
prove real A/B positive bytes before freeze; prove B continuity; record
A's authenticated deletion request; reject every A new write, update,
signed/TUS delayed completion, S3 direct/multipart attempt, and
cross-owner read/write. Verify no post-freeze bytes under any A prefix;
inspect aborted and unsettled leases, orphan bytes, multipart sessions,
Auth deletion and retention. Reconcile failures without deleting unknown
or concurrently created real user data.

Existing Supabase generated S3 keys must be tested if ever enabled or
available; they cannot be claimed safe by an R2-only test. If a
privileged Supabase Storage path remains usable, it is a separate
release blocker until explicitly fenced or removed from the controlled
private-media surface. Do not mark `uploadBarrierEnforced=true` on the
basis of an adapter unit test, offline CI, or a denied baseline.

## Non-deploying review evidence

- Canonical writer: `supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs`.
- Optional attested RPC candidate: `docs/architecture/sql/V2-ALL251-ATTESTED-PRIVILEGED-STORAGE-WRITER-REVIEW.sql` (not a migration).
- Non-deployed R2 adapter and offline test:
  `supabase/functions/_shared/all251R2StorageReviewAdapter.mjs` and
  `all251R2StorageReviewAdapter.test.mjs`.
- Existing provider route suite, protected environment and PR #18
  remain distinct; no production SQL, secrets, Storage objects, Worker,
  R2 bucket, Supabase project or release flags were changed in this review.
