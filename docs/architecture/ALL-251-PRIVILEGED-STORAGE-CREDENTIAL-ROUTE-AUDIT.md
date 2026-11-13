# ALL-251 — Privileged Storage credential and upload-route acceptance

Status: **NOT ACCEPTED.** Review / staging evidence only. The operational
account-deletion worker and complete-account export must remain disabled.

## Authoritative evidence

- Hosted synthetic two-account run:
  [ALL-251 run 43427895858](https://github.com/allinproject/All-In-V2/actions/runs/43427895858).
  Controlled lease-first POST, PUT replacement, byte SHA-256 readback,
  pending-upload deletion fence, and other-owner independence **passed**.
  Raw `sb_secret_` Storage POST succeeded **after** owner's deletion request.
  Therefore the exclusive privileged writer guarantee **failed**.
- Cleanup verified independently: no remaining synthetic Auth users, Storage
  objects, deletion requests, or upload leases in temporary staging after run.
- Supabase security contract: `service_role`/secret keys bypass Storage RLS.
  New secret keys may be separated per service for rotation, but **each retains
  full service-role authority**; extra keys do not create bucket-level scopes.
  See https://supabase.com/docs/guides/getting-started/api-keys and
  https://supabase.com/docs/guides/storage/security/access-control
- Supabase-generated S3 access key pairs bypass Storage RLS; user JWT S3 session
  tokens use Storage RLS instead.
  See https://supabase.com/docs/guides/storage/s3/authentication
- Signed upload URLs cannot be revoked individually. Revoke an old signing key
  to invalidate its URLs; Auth key rotation is not enough.
  See https://supabase.com/docs/guides/storage/security/signing-keys
- TUS resumable upload URLs can remain valid up to 24 hours and upload
  completion can occur after initiation. Do not treat preflight or a deleted
  client session as evidence that all in-flight uploads are finished.
  See https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Supabase recommends treating the internal `storage` schema as read-only.
  Do **not** add unsupported mutation triggers there to override provider
  behavior. See https://supabase.com/docs/guides/storage/schema/design

## Route inventory and required control

| Route / credential | Known owning surface | Current evidence | Release requirement |
| --- | --- | --- | --- |
| Application upload, replacement | `v2-private-storage-writer` Edge shell, `trainingPrivilegedStorageWriter.mjs` | Server-side lease, privileged bytes readback and settlement passed staging; Edge writer is default OFF | Keep exactly scoped owner/bucket/path, live JWT, no key in clients; enable only after exclusive credential custody and full race acceptance |
| Private encrypted export archive/page writes | Existing `trainingExportSupabaseArchive.mjs`, `trainingPrivilegedAccountExportBarrier.mjs` | Reuses canonical writer; local tests, no production acceptance | Do not allow old direct upload callback or a second writer on deployment; require approved export-request/session |
| Direct Storage REST with project secret/service-role key | Project's privileged API; GitHub temporary test harness | **Confirmed bypass** of deletion lease after pending deletion | Remove all untrusted holders and alternate direct upload workflows; rotate/revoke credentials no longer needed; independently test remaining custodians. No SQL/RLS-only fix |
| Other Edge functions using elevated key | Coach, billing, device, Stripe and other server functions; inspect live deployment and their complete dependency graphs | Several entrypoints read `SUPABASE_SERVICE_ROLE_KEY`; current runtime source inventory does not demonstrate full deployed key isolation | Migrate to user-scoped/least-privilege APIs where possible, otherwise document explicit trusted purpose. Audit deployed bundles and prevent arbitrary Storage API calls |
| Protected GitHub staging jobs | `v2-all251-temporary-auth-smoke.yml`, `v2-all251-temporary-hosted-storage.yml`, `v2-all251-hosted-privileged-writer.yml` | Staging secret is referenced by these workflows; bypass probe restricted to manual + protected environment | Restrict environment approvals, audit and remove unused secrets after testing, no scheduled or automatic raw-bypass probes |
| Native mobile, web clients, untrusted external tools | Publishable Auth JWT expected | No approved client direct private Storage upload path | Never ship secret/service-role/S3 keys; do not mint signed upload tokens until their deletion-state completion fence is accepted |
| Generated privileged S3 access keys / presigned S3 operations | Supabase Storage dashboard, external S3 tools, CI and operator credentials | **NOT INSPECTABLE** through available project read-only SQL/source; no proof keys absent | Operator audits dashboard, lists/revokes unused key pairs, validates enabled protocol and all external holders. Disable unrestricted S3 access when unnecessary |
| User-scoped S3 session token | S3 API with user JWT | RLS-scoped in documented model; no V2 accepted writer | Forbid pending-deletion writes through approved RLS and upload lifecycle. Test S3 multipart begin/complete and delayed completion before accepting |
| Signed uploads, signed URL minting | Storage signing key and server/user API | No accepted V2 minting pathway; previously issued URLs cannot be inferred from source | No issuance in production until bounded durable lease and completion tracking; inventory outstanding tokens; rotate/revoke signing key if untrusted outstanding URLs exist |
| TUS resumable, SDK upsert, multi-part finalization | Storage `/upload/resumable`, signed TUS and direct upload hostname | Not yet tested on hosted V2 | No issuance or resumption unless authenticated scoped upload and authoritative completion/lease fencing proven. Ensure stale pending uploads cannot recreate deleted bytes |
| Studio/CLI/admin/manual Storage writes | Supabase administrators and support/automation accounts | Credential holders and permissions outside current connector visibility | Inventory authorized operators/PATs, remove unused credentials, require change control and explicit incident/test exception |

## Source inventory versus credential custody

The repository's
`scripts/test-all251-runtime-storage-writer-inventory.mjs` fails CI if a new
runtime Storage REST, direct upload, signed upload, S3 or TUS write pattern is
introduced without a reviewed canonical writer. Source scanning is a guard
against accidental introduction, **not** evidence that service-role credentials
or external API clients have been revoked or cannot bypass the app.

Temporary staging has a separate protected GitHub environment and synthetic
users only. It must never use live V1/V2 production service keys. The dedicated
direct-privileged bypass workflow is manual-only.

## Required acceptance before any deletion-worker activation

1. Prove **all** service-role/secret credentials, S3 keypairs, signing-key
   holders, external workers, GitHub Actions secrets, Studio/CLI operators
   and deployed Edge function integrations have been inventoried. Record
   owner, purpose, reach, last use, and rotation/revocation decision in a
   restricted credential register; never store key material in Git/Linear.
2. Restrict privileged Storage write capability to the canonical trusted
   writer's custody. Other backends should use user-scoped JWT/RLS where
   possible. **Multiple Supabase secret keys remain equally privileged** and
   cannot, alone, prove exclusivity.
3. Explicitly deny unapproved signed upload URL issuance, direct S3 use and
   resumable/multipart completion. Audit/revoke old signing keys if issued
   URLs might remain live. No upload lease may auto-expire after a timeout.
4. Rerun real two-user hosted HTTP acceptance with a pending account deletion:
   controlled A writes denied, B writes continue, raw privileged REST, S3,
   signed and resumable bypass probes **all** denied by enforceable
   authorization, late completion rejected, and all synthetic objects and
   identities removed with independently verified byte absence.
5. Approve the release only after the operational readiness function obtains
   durable provider-level evidence of complete private Storage and upload
   barrier enforcement. Until then it must return
   `completePrivateStorage=false`, `uploadBarrierEnforced=false` and the
   operational worker must be disabled.

### Architecture decision still required

Supabase master keys are intentionally unrestricted within a project. If the
product requires a **provider-enforced guarantee** that even another privileged
credential cannot upload after account deletion starts, a single shared
project-wide secret with RLS is insufficient. Evaluate isolating private
Storage behind a separate, controlled credential boundary/provider or using
an authenticated scoped Storage design plus custody controls. Do **not**
introduce a second source of truth or deploy a new project without an approved
architecture/recovery/cost decision.

## 2026-11-13 credential audit — observed inventory and disposition

Audited **temporary staging only** (`fbtgknlxjyeqrxemskbl`) through current
connected project metadata, publishable-key listings, Edge deployment source,
24-hour Storage operation logs, repository workflows and security advisors.
No private credential material is recorded here.

| Credential / route | Observed evidence | Disposition / next proof |
| --- | --- | --- |
| Modern publishable keys | Two enabled entries: `default` and `all251_temp_staging_publishable_key` | **KEEP pending usage verification**; public keys do not themselves bypass RLS; removal is unrelated to privileged upload isolation |
| Legacy anon key | One enabled legacy `anon` API key | **KEEP pending compatibility audit**; it is not a privileged upload credential |
| Staging modern secret key | `ALL251_TEMP_STAGING_SECRET_KEY` is referenced by exactly three reviewed staging GitHub workflows | **KEEP for the current protected acceptance workflow** until a replacement test mechanism exists; credential value, full key-list, holder count and revocation status are unavailable through connected actions |
| GitHub `v2-all251-temporary-auth-smoke.yml` | Protected `all251-temporary-staging` environment; push and manual trigger | **RETAIN** as currently used by staging testing; review whether automatic privileged test coverage is still required before disabling |
| GitHub `v2-all251-temporary-hosted-storage.yml` | Protected staging environment, manual trigger | **RETAIN** while hosted Storage acceptance is in progress |
| GitHub `v2-all251-hosted-privileged-writer.yml` | Protected staging environment, **manual-only** direct bypass probe | **RETAIN disabled from push** until negative bypass tests have been superseded; do not run casually |
| Deployed `v2-coach` Edge function (v2) | Active, `verify_jwt=true`; deployed source references `SUPABASE_SERVICE_ROLE_KEY`, no direct Storage upload observed in inspected source | **PRESERVE**; audit actual credential custody and replace elevated access where possible before any rotation |
| Deployed `v2-account-export-download` Edge function (v5) | Active, `verify_jwt=true`; no direct Storage writer observed | **PRESERVE**; this is a read/download flow, not evidence of unrestricted upload |
| `v2-private-storage-writer` Edge function | Not deployed in inspected staging | **KEEP OFF** until exclusive credential scope and hosted race tests pass |
| Generated S3 access key pairs | Key-pair inventory/permissions not returned by connected Supabase actions | **UNKNOWN — DO NOT CLAIM DISABLED**; owner must review Storage S3 credentials and revoke only unused keys once holders are reconciled |
| Storage signing keys / outstanding signed upload URLs | Signing-key inventory and issued URL records unavailable from connected actions | **UNKNOWN**; review issuance and rotate only after active signed URLs/consumers are identified |
| TUS/multipart or external CLI/Studio writers | No positive owner inventory exposed by connector; source inventory is not equivalent to provider credential inventory | **UNKNOWN**; check operator accounts, S3 clients, upload completions and external integration credentials |
| Raw Storage REST privileged path | Real hosted test demonstrated a post-deletion-request upload succeeded using the staging secret | **FAILED EXCLUSIVE ENFORCEMENT**; cannot mark upload barrier accepted until unauthorized privileged credential holders and paths are eliminated |

**Operational log corroboration:** The past-24-hour staging Storage log aggregate
reported 17 `service_role` POST object uploads, 3 PUT replacements, and 16
deletions (plus read/list activity). These totals include acceptance testing,
are not attributable to unique credential holders, and are **not proof** that
unobserved external credentials or active S3/signed URLs do not exist.

**Staging state at audit:** Two private buckets, zero Auth users, zero Stored
objects, zero active write leases and zero custom `storage.objects` policies;
`service_role` has `BYPASSRLS`. The connected Supabase security advisor
was inspected, but its generic private-schema RLS findings do not establish
that all project-level privileged credential holders are accounted for.

**Credential removal decision:** No key or external access is proven unused.
Revoking any project-wide secret could disrupt existing Coach/Auth/hosted test
workflows. Therefore **no credential was revoked or disabled** in this audit;
the manual-only raw bypass probe remains restricted. Access changes require
the restricted Supabase dashboard/GitHub environment administrator to inventory
real keyholders, identify last use, replace working consumers, revoke abandoned
keys, and confirm that the old credential fails when exercised.

**Residual gate:** Key rotation or additional project secret keys **do not**
make service-role Storage access owner-scoped. Do not set
`uploadBarrierEnforced=true` or enable account deletion without an approved
architecture and live negative hosted bypass acceptance.
